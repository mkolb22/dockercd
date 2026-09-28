#!/usr/bin/env bash
# Execute the disposable authenticated recovery drill described in
# docs/recovery-drill-design.md. It is intentionally unusable against the
# active Docker context; the preflight proves a dedicated daemon first.
set -euo pipefail

root="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
source "$root/scripts/recovery-drill-images.env"
source "$root/scripts/recovery-drill-lib.sh"

fail() {
  printf 'recovery drill: %s\n' "$*" >&2
  exit 1
}

for tool in docker git openssl jq go perl; do
  command -v "$tool" >/dev/null 2>&1 || fail "required command is unavailable: $tool"
done

[[ -z "${DOCKER_HOST:-}" && -z "${DOCKER_CONTEXT:-}" ]] || fail "unset ambient DOCKER_HOST and DOCKER_CONTEXT"
[[ -z "${DOCKER_BIN:-}" ]] || fail "DOCKER_BIN test overrides are forbidden during execution"
drill_context="${DOCKERCD_RECOVERY_DRILL_CONTEXT:-}"
protected_contexts="${DOCKERCD_RECOVERY_PROTECTED_CONTEXTS:-}"
[[ -n "$drill_context" && -n "$protected_contexts" ]] || fail "dedicated and protected Docker contexts are required"

# Re-run immediately before any object creation. The preflight prints only a
# non-secret context/daemon identity pair; preserve it with release evidence.
preflight_output="$(DOCKERCD_RECOVERY_DRILL_CONTEXT="$drill_context" \
  DOCKERCD_RECOVERY_PROTECTED_CONTEXTS="$protected_contexts" \
  "$root/scripts/recovery-drill-preflight.sh")" || exit 1
preflight_daemon_id="$(printf '%s\n' "$preflight_output" | awk -F= '$1 == "drill_daemon_id" { print $2 }')"
[[ "$preflight_daemon_id" =~ ^[[:alnum:].-]+$ ]] || fail "preflight did not provide a safe daemon identity"

# A controller can only mount the daemon socket when the dedicated daemon is
# local and exposes Docker's standard host socket. Reject remote, rootless, or
# custom sockets rather than guessing a mount source that could be production.
# Context metadata is local client configuration, but a corrupted client or
# credential helper must not hold the release harness open before its main
# bounded Docker wrapper is used.
context_endpoint="$(bounded_command 30 docker context inspect "$drill_context" --format '{{(index .Endpoints "docker").Host}}' 2>/dev/null)" \
  || fail "cannot inspect dedicated Docker context"
[[ "$context_endpoint" == "unix:///var/run/docker.sock" ]] || fail "dedicated context must use unix:///var/run/docker.sock"

run_id="$(openssl rand -hex 8)"
[[ "$run_id" =~ ^[a-f0-9]{16}$ ]] || fail "could not generate a safe run identity"
prefix="dockercd-drill-$run_id"
app_name="$prefix"
project_name="$prefix"
network_name="$prefix-network"
data_volume="$prefix-data"
restore_volume="$prefix-restore"
controller_name="$prefix-controller"
restored_name="$prefix-restored"
git_name="$prefix-git"

work_dir="$(mktemp -d "${TMPDIR:-/tmp}/dockercd-recovery-drill.XXXXXX")"
evidence_dir="$root/.recovery-drills/$run_id"
mkdir -p "$evidence_dir"
chmod 0700 "$work_dir" "$evidence_dir"
umask 077
bounded_active_state_file="$work_dir/active-bounded-command"
bounded_temp_dir="$work_dir"

network_id=""
data_volume_id=""
restore_volume_id=""
controller_id=""
restored_id=""
git_id=""
fixture_image_id=""
token_file=""
cleanup_started=false
drill_succeeded=false
cleanup_containers=()
cleanup_networks=()
cleanup_volumes=()
cleanup_images=()

docker_context() {
  local context="$1"
  shift
  bounded_command 180 docker --context "$context" "$@" || fail "bounded Docker operation failed"
}

docker_drill() { docker_context "$drill_context" "$@"; }

# Cleanup must continue attempting every owned-resource removal even if one
# operation fails. It has the same hard timeout as normal Docker work, but it
# returns an error to the caller instead of terminating the EXIT trap.
docker_cleanup_context() {
  local context="$1"
  shift
  bounded_command 180 docker --context "$context" "$@"
}

docker_cleanup_drill() { docker_cleanup_context "$drill_context" "$@"; }
bounded_git() { bounded_command 120 git "$@"; }
run_verifier() { (cd "$root/src" && bounded_command 120 go run ./cmd/recovery-drill-verify "$@"); }

assert_execution_identity() {
  local observed
  observed="$(docker_drill info --format '{{.ID}}')" || fail "could not identify dedicated Docker daemon"
  [[ "$observed" == "$preflight_daemon_id" ]] || fail "execution daemon differs from preflight daemon"
}

cleanup_execution_identity() {
  local observed
  observed="$(docker_cleanup_drill info --format '{{.ID}}')" || return 1
  [[ "$observed" == "$preflight_daemon_id" ]]
}

record_protected_state_with() {
  local docker_call="$1"
  shift
  local phase="$1"
  local context
  IFS=',' read -r -a contexts <<< "$protected_contexts"
  for context in "${contexts[@]}"; do
    [[ "$context" =~ ^[[:alnum:]_.-]+$ ]] || return 1
    local ids
    ids="$("$docker_call" "$context" ps -aq)" || return 1
    if [[ -n "$ids" ]]; then
      # Status includes a human uptime field that changes while the drill runs;
      # retain only stable identity/lifecycle values needed for non-impact proof.
      "$docker_call" "$context" inspect --format '{{.Id}} {{.State.Running}} {{if .State.Health}}{{.State.Health.Status}}{{end}} {{.RestartCount}} {{.State.StartedAt}}' $ids \
        | sort >"$evidence_dir/protected-${context}-${phase}.txt"
    else
      : >"$evidence_dir/protected-${context}-${phase}.txt"
    fi
  done
}

record_protected_state() { record_protected_state_with docker_context "$@"; }
record_protected_state_cleanup() { record_protected_state_with docker_cleanup_context "$@"; }

assert_protected_unchanged() {
  local context
  IFS=',' read -r -a contexts <<< "$protected_contexts"
  for context in "${contexts[@]}"; do
    if ! cmp -s "$evidence_dir/protected-${context}-before.txt" "$evidence_dir/protected-${context}-after.txt"; then
      printf 'protected context changed: %s\n' "$context" >&2
      return 1
    fi
  done
}

record_cleanup_inventory() {
  local kind ids id label
  for kind in container network volume image; do
    case "$kind" in
      container)
        ids="$(docker_cleanup_drill ps -aq --filter "label=com.dockercd.drill-run=$run_id")" || return 1
        ;;
      network)
        ids="$(docker_cleanup_drill network ls -q --filter "label=com.dockercd.drill-run=$run_id")" || return 1
        ;;
      volume)
        ids="$(docker_cleanup_drill volume ls -q --filter "label=com.dockercd.drill-run=$run_id")" || return 1
        ;;
      image)
        ids="$(docker_cleanup_drill image ls -q --filter "label=com.dockercd.drill-run=$run_id" | sort -u)" || return 1
        ;;
    esac
    case "$kind" in
      container) cleanup_containers=() ;;
      network) cleanup_networks=() ;;
      volume) cleanup_volumes=() ;;
      image) cleanup_images=() ;;
    esac
    while IFS= read -r id; do
      [[ -n "$id" ]] || continue
      case "$kind" in
        container)
          label="$(docker_cleanup_drill inspect --format '{{index .Config.Labels "com.dockercd.drill-run"}}' "$id")" || return 1
          ;;
        network)
          label="$(docker_cleanup_drill network inspect --format '{{index .Labels "com.dockercd.drill-run"}}' "$id")" || return 1
          ;;
        volume)
          label="$(docker_cleanup_drill volume inspect --format '{{index .Labels "com.dockercd.drill-run"}}' "$id")" || return 1
          ;;
        image)
          label="$(docker_cleanup_drill image inspect --format '{{index .Config.Labels "com.dockercd.drill-run"}}' "$id")" || return 1
          ;;
      esac
      [[ "$label" == "$run_id" ]] || return 1
      case "$kind" in
        container) cleanup_containers+=("$id") ;;
        network) cleanup_networks+=("$id") ;;
        volume) cleanup_volumes+=("$id") ;;
        image) cleanup_images+=("$id") ;;
      esac
    done <<< "$ids"
    case "$kind" in
      container) printf '%s\n' "${cleanup_containers[@]}" | sed '/^$/d' | sort >"$evidence_dir/cleanup-containers.txt" ;;
      network) printf '%s\n' "${cleanup_networks[@]}" | sed '/^$/d' | sort >"$evidence_dir/cleanup-networks.txt" ;;
      volume) printf '%s\n' "${cleanup_volumes[@]}" | sed '/^$/d' | sort >"$evidence_dir/cleanup-volumes.txt" ;;
      image) printf '%s\n' "${cleanup_images[@]}" | sed '/^$/d' | sort >"$evidence_dir/cleanup-images.txt" ;;
    esac
  done
}

assert_no_owned_resources() {
  local remnants=""
  local ids
  ids="$(docker_cleanup_drill ps -aq --filter "label=com.dockercd.drill-run=$run_id")" || return 1
  [[ -z "$ids" ]] || remnants+="containers=$ids\n"
  ids="$(docker_cleanup_drill network ls -q --filter "label=com.dockercd.drill-run=$run_id")" || return 1
  [[ -z "$ids" ]] || remnants+="networks=$ids\n"
  ids="$(docker_cleanup_drill volume ls -q --filter "label=com.dockercd.drill-run=$run_id")" || return 1
  [[ -z "$ids" ]] || remnants+="volumes=$ids\n"
  ids="$(docker_cleanup_drill image ls -q --filter "label=com.dockercd.drill-run=$run_id" | sort -u)" || return 1
  [[ -z "$ids" ]] || remnants+="images=$ids\n"
  printf '%b' "$remnants" >"$evidence_dir/cleanup-remnants.txt"
  [[ -z "$remnants" ]]
}

cleanup() {
  local original_status=$?
  local cleanup_failed=false
  local container running image
  [[ "$cleanup_started" == true ]] && exit "$original_status"
  cleanup_started=true
  trap - EXIT INT TERM
  # Every cleanup array is initialized above, but macOS's Bash still treats an
  # empty-array expansion as unbound with nounset enabled. Cleanup must run to
  # completion after a failure before any or all resource types were created.
  set +e
  set +u

  # An external interrupt can arrive while a bounded Docker/Git/verifier
  # child is still active. Terminate and reap that isolated group before any
  # resource deletion or temporary-directory removal.
  terminate_active_bounded_command

  if ! cleanup_execution_identity; then
    # A mutable context that no longer resolves to the preflight daemon must
    # never receive a deletion request, even for a unique drill label.
    cleanup_failed=true
  else
    record_cleanup_inventory || cleanup_failed=true
    for container in "${cleanup_containers[@]}"; do
      running="$(docker_cleanup_drill inspect --format '{{.State.Running}}' "$container")"
      if [[ "$running" == true ]]; then
        docker_cleanup_drill container stop -t 15 "$container" >/dev/null || cleanup_failed=true
      elif [[ "$running" != false ]]; then
        cleanup_failed=true
      fi
    done
    for container in "${cleanup_containers[@]}"; do
      docker_cleanup_drill container rm -f "$container" >/dev/null || cleanup_failed=true
    done
    for network_id in "${cleanup_networks[@]}"; do
      docker_cleanup_drill network rm "$network_id" >/dev/null || cleanup_failed=true
    done
    for data_volume_id in "${cleanup_volumes[@]}"; do
      docker_cleanup_drill volume rm "$data_volume_id" >/dev/null || cleanup_failed=true
    done
    for image in "${cleanup_images[@]}"; do
      docker_cleanup_drill image rm "$image" >/dev/null || cleanup_failed=true
    done
    assert_no_owned_resources || cleanup_failed=true
  fi
  record_protected_state_cleanup after || cleanup_failed=true
  assert_protected_unchanged || cleanup_failed=true
  rm -f -- "$token_file"
  rm -rf -- "$work_dir"

  if [[ "$original_status" -eq 0 && "$drill_succeeded" == true && "$cleanup_failed" == false ]]; then
    printf 'recovery drill succeeded; redacted evidence: %s\n' "$evidence_dir"
    exit 0
  fi
  printf 'recovery drill failed or cleanup was incomplete; redacted evidence: %s\n' "$evidence_dir" >&2
  exit 1
}
trap cleanup EXIT
trap 'exit 130' INT TERM

record_protected_state before || fail "could not record protected-context baseline"
printf '%s\n' "$preflight_output" >"$evidence_dir/preflight.env"
assert_execution_identity

assert_image_id() {
  local tag="$1"
  local expected_id="$2"
  local actual_id
  actual_id="$(docker_drill image inspect "$tag" --format '{{.Id}}')" || fail "required local image is unavailable"
  [[ "$actual_id" == "$expected_id" ]] || fail "local image does not match its reviewed immutable identity"
}

assert_image_id "$DOCKERCD_RECOVERY_CONTROLLER_IMAGE" "$DOCKERCD_RECOVERY_CONTROLLER_IMAGE_ID"
assert_image_id "$DOCKERCD_RECOVERY_WEB_IMAGE" "$DOCKERCD_RECOVERY_WEB_IMAGE_ID"
assert_execution_identity
socket_probe_id="$(docker_drill create --label "com.dockercd.drill-run=$run_id" \
  -v /var/run/docker.sock:/var/run/docker.sock --entrypoint docker "$DOCKERCD_RECOVERY_CONTROLLER_IMAGE_ID" \
  -H unix:///var/run/docker.sock info --format '{{.ID}}')" || fail "cannot create mounted socket identity probe"
mounted_socket_identity="$(docker_drill start -a "$socket_probe_id")" || fail "cannot prove mounted socket identity"
docker_drill container rm "$socket_probe_id" >/dev/null || fail "cannot remove mounted socket identity probe"
[[ "$mounted_socket_identity" == "$preflight_daemon_id" ]] || fail "mounted controller socket differs from dedicated daemon"
printf '%s\n' "$DOCKERCD_RECOVERY_CONTROLLER_IMAGE_ID" >"$evidence_dir/controller-image-id.txt"
printf '%s\n' "$DOCKERCD_RECOVERY_WEB_IMAGE_ID" >"$evidence_dir/web-image-id.txt"

# Build two commits while keeping release at A. Commit B is retained in the
# bare repository but unreachable by the served release ref until explicitly
# advanced after the first successful sync.
repository="$work_dir/repository"
build_context="$work_dir/fixture-image"
mkdir -p "$build_context"
bounded_git init --bare "$build_context/repo.git" >/dev/null
bounded_git clone "$build_context/repo.git" "$repository" >/dev/null
bounded_git -C "$repository" config user.email recovery-drill@invalid
bounded_git -C "$repository" config user.name recovery-drill
sed "s/__RUN_ID__/$run_id/g" "$root/scripts/testdata/recovery-drill/compose-a.yml.in" >"$repository/docker-compose.yml"
bounded_git -C "$repository" add docker-compose.yml
bounded_git -C "$repository" commit -m 'sentinel A' >/dev/null
sha_a="$(bounded_git -C "$repository" rev-parse HEAD)"
bounded_git -C "$repository" branch -M release
bounded_git -C "$repository" push origin release >/dev/null
sed "s/__RUN_ID__/$run_id/g" "$root/scripts/testdata/recovery-drill/compose-b.yml.in" >"$repository/docker-compose.yml"
bounded_git -C "$repository" add docker-compose.yml
bounded_git -C "$repository" commit -m 'sentinel B' >/dev/null
sha_b="$(bounded_git -C "$repository" rev-parse HEAD)"
bounded_git -C "$repository" push origin HEAD:refs/heads/candidate-b >/dev/null
bounded_git -C "$repository" checkout -q release
[[ "$sha_a" =~ ^[a-f0-9]{40}$ && "$sha_b" =~ ^[a-f0-9]{40}$ && "$sha_a" != "$sha_b" ]] || fail "fixture revisions are invalid"

mkdir -p "$build_context/image"
cp -R "$build_context/repo.git" "$build_context/image/repo.git"
cp "$root/scripts/testdata/recovery-drill/git-http-backend" "$build_context/image/git-http-backend"
cp "$root/scripts/testdata/recovery-drill/fixture.Dockerfile" "$build_context/image/Dockerfile"
fixture_image_id="$(docker_drill build --quiet --pull=false \
  --label "com.dockercd.drill-run=$run_id" \
  --build-arg "CONTROLLER_IMAGE=$DOCKERCD_RECOVERY_CONTROLLER_IMAGE_ID" \
  "$build_context/image")" || fail "could not build internal Git fixture"

network_id="$(docker_drill network create --internal --label "com.dockercd.drill-run=$run_id" "$network_name")"
data_volume_id="$(docker_drill volume create --label "com.dockercd.drill-run=$run_id" "$data_volume")"
restore_volume_id="$(docker_drill volume create --label "com.dockercd.drill-run=$run_id" "$restore_volume")"
git_id="$(docker_drill run -d --name "$git_name" --network "$network_id" --network-alias git-fixture \
  --label "com.dockercd.drill-run=$run_id" "$fixture_image_id")"
printf 'network_id=%s\ndata_volume_id=%s\nrestore_volume_id=%s\ngit_id=%s\nfixture_image_id=%s\n' \
  "$network_id" "$data_volume_id" "$restore_volume_id" "$git_id" "$fixture_image_id" \
  >"$evidence_dir/objects.env"

create_controller() {
  local name="$1"
  local volume="$2"
  docker_drill create --name "$name" --network "$network_id" \
    --label "com.dockercd.drill-run=$run_id" \
    -v "$volume:/data" -v /var/run/docker.sock:/var/run/docker.sock \
    -e DOCKERCD_GIT_ALLOWED_HOSTS=git-fixture \
    --entrypoint /bin/sh "$DOCKERCD_RECOVERY_CONTROLLER_IMAGE_ID" \
    -ceu 'umask 077; export DOCKERCD_API_TOKEN="$(cat /run/drill-token)"; exec dockercd serve'
}

token_file="$work_dir/drill-token"
openssl rand -hex 32 >"$token_file"
controller_id="$(create_controller "$controller_name" "$data_volume")"
printf 'controller_id=%s\n' "$controller_id" >>"$evidence_dir/objects.env"
docker_drill cp "$token_file" "$controller_id:/run/drill-token"
docker_drill start "$controller_id" >/dev/null

wait_ready() {
  local container="$1"
  local attempts=0
  until docker_drill exec "$container" curl --fail --silent --show-error --max-time 2 http://127.0.0.1:8080/readyz >/dev/null 2>&1; do
    ((attempts += 1))
    (( attempts < 30 )) || fail "temporary controller did not become ready"
    sleep 1
  done
}
wait_ready "$controller_id"
docker_drill exec "$controller_id" curl --fail --silent --show-error --max-time 5 \
  http://git-fixture:8080/cgi-bin/git/repo.git/HEAD >/dev/null

controller_get() {
  local container="$1"
  local path="$2"
  local response body
  response="$(docker_drill exec "$container" sh -ceu '
    token="$(cat /run/drill-token)"
    umask 077
    printf "%s\n" "header = \"Authorization: Bearer $token\"" >/run/drill-curl.conf
    exec curl --silent --show-error --max-time 30 --max-redirs 0 \
      --config /run/drill-curl.conf --write-out "\\n%{http_code}" \
      "http://127.0.0.1:8080$1"
  ' sh "$path")" || return 1
  last_http_status="${response##*$'\n'}"
  body="${response%$'\n'*}"
  [[ "$last_http_status" =~ ^[0-9]{3}$ && "$last_http_status" == 200 ]] || return 1
  printf '%s' "$body"
}

controller_post_json() {
  local container="$1"
  local path="$2"
  local response body
  response="$(docker_drill exec -i "$container" sh -ceu '
    token="$(cat /run/drill-token)"
    umask 077
    printf "%s\n" "header = \"Authorization: Bearer $token\"" >/run/drill-curl.conf
    exec curl --silent --show-error --max-time 120 --max-redirs 0 \
      --config /run/drill-curl.conf -H "Content-Type: application/json" \
      --data-binary @- --write-out "\\n%{http_code}" "http://127.0.0.1:8080$1"
  ' sh "$path")" || return 1
  last_http_status="${response##*$'\n'}"
  body="${response%$'\n'*}"
  [[ "$last_http_status" =~ ^[0-9]{3}$ ]] || return 1
  printf '%s' "$body"
}

controller_cli() {
  local container="$1"
  shift
  docker_drill exec "$container" sh -ceu '
    export DOCKERCD_API_TOKEN="$(cat /run/drill-token)"
    exec dockercd "$@"
  ' sh "$@"
}

last_http_status=""

# Require the policy needed for rollback's forced image pull before registering
# the application. The compose project exists only as a command argument here.
docker_drill compose -f "$repository/docker-compose.yml" -p "$project_name" pull >/dev/null

manifest="$work_dir/application.json"
sed -e "s/__APP_NAME__/$app_name/g" -e "s/__PROJECT_NAME__/$project_name/g" \
  "$root/scripts/testdata/recovery-drill/application.json.in" >"$manifest"

unauthenticated_status="$(docker_drill exec "$controller_id" sh -ceu '
  exec curl --silent --output /dev/null --write-out "%{http_code}" --max-time 10 \
    http://127.0.0.1:8080/api/v1/applications
')"
[[ "$unauthenticated_status" == 401 ]] || fail "unauthenticated request was not rejected"
wrong_status="$(docker_drill exec "$controller_id" sh -ceu '
  exec curl --silent --output /dev/null --write-out "%{http_code}" --max-time 10 \
    -H "Authorization: Bearer wrong" http://127.0.0.1:8080/api/v1/applications
')"
[[ "$wrong_status" == 401 ]] || fail "wrong bearer was not rejected"
controller_post_json "$controller_id" /api/v1/applications <"$manifest" >"$work_dir/create.json"
[[ "$last_http_status" == 201 ]] || fail "application creation did not return 201"
jq -e --arg app "$app_name" '.metadata.name == $app' "$work_dir/create.json" >/dev/null

assert_sentinel() {
  local revision="$1"
  local ids
  ids=( $(docker_drill ps -q \
    --filter "label=com.dockercd.drill-run=$run_id" \
    --filter "label=com.docker.compose.project=$project_name" \
    --filter 'label=com.docker.compose.service=sentinel') )
  [[ "${#ids[@]}" -eq 1 ]] || fail "expected exactly one live sentinel"
  local actual
  actual="$(docker_drill inspect --format '{{index .Config.Labels "com.dockercd.drill.revision"}}' "${ids[0]}")"
  [[ "$actual" == "$revision" ]] || fail "live sentinel revision differs from expected evidence"
  printf 'sentinel_%s_id=%s\n' "$revision" "${ids[0]}" >>"$evidence_dir/objects.env"
}

assert_history_record() {
  local file="$1" operation="$2" result="$3" sha="$4"
  jq -e --arg operation "$operation" --arg result "$result" --arg sha "$sha" \
    'any(.items[]; .operation == $operation and .result == $result and .commitSHA == $sha)' "$file" >/dev/null
}

controller_cli "$controller_id" app desired "$app_name" --server http://127.0.0.1:8080 >"$work_dir/desired-a.json"
jq -e --arg sha "$sha_a" '.headSHA == $sha' "$work_dir/desired-a.json" >/dev/null
controller_cli "$controller_id" app diff "$app_name" --json --server http://127.0.0.1:8080 >"$work_dir/diff-a.json"
jq -e '.inSync == false and any(.toCreate[]?; .serviceName == "sentinel" and .changeType == "create")' "$work_dir/diff-a.json" >/dev/null
controller_cli "$controller_id" app sync "$app_name" --server http://127.0.0.1:8080 >/dev/null
controller_get "$controller_id" "/api/v1/applications/$app_name" >"$work_dir/app-a.json"
controller_get "$controller_id" "/api/v1/applications/$app_name/history?limit=100" >"$work_dir/history-a.json"
jq -e --arg sha "$sha_a" '.status.lastSyncedSHA == $sha' "$work_dir/app-a.json" >/dev/null
assert_history_record "$work_dir/history-a.json" manual success "$sha_a"
assert_sentinel A

docker_drill exec "$git_id" git --git-dir=/srv/git/repo.git update-ref refs/heads/release "$sha_b"
controller_cli "$controller_id" app desired "$app_name" --server http://127.0.0.1:8080 >"$work_dir/desired-b.json"
jq -e --arg sha "$sha_b" '.headSHA == $sha' "$work_dir/desired-b.json" >/dev/null
controller_cli "$controller_id" app diff "$app_name" --json --server http://127.0.0.1:8080 >"$work_dir/diff-b.json"
jq -e '.inSync == false and (any(.toUpdate[]?; .serviceName == "sentinel") or any(.toCreate[]?; .serviceName == "sentinel"))' "$work_dir/diff-b.json" >/dev/null
controller_cli "$controller_id" app sync "$app_name" --server http://127.0.0.1:8080 >/dev/null
controller_get "$controller_id" "/api/v1/applications/$app_name" >"$work_dir/app-b.json"
[[ "$last_http_status" == 200 ]] || fail "application B inspection did not return 200"
jq -e --arg sha "$sha_b" '.status.lastSyncedSHA == $sha' "$work_dir/app-b.json" >/dev/null
controller_get "$controller_id" "/api/v1/applications/$app_name/history?limit=100" >"$work_dir/history-b.json"
assert_history_record "$work_dir/history-b.json" manual success "$sha_a"
assert_history_record "$work_dir/history-b.json" manual success "$sha_b"
assert_sentinel B

controller_cli "$controller_id" app rollback "$app_name" --sha "$sha_a" --server http://127.0.0.1:8080 >/dev/null
controller_get "$controller_id" "/api/v1/applications/$app_name/history?limit=100" >"$work_dir/history-before-restore.json"
assert_history_record "$work_dir/history-before-restore.json" rollback success "$sha_a"
assert_sentinel A

unknown_sha="$(openssl rand -hex 20)"
[[ "$unknown_sha" != "$sha_a" && "$unknown_sha" != "$sha_b" ]] || fail "generated unknown revision collided"
controller_post_json "$controller_id" "/api/v1/applications/$app_name/rollback" \
  <<<"{\"targetSHA\":\"$unknown_sha\"}" >"$work_dir/unknown-rollback.json"
[[ "$last_http_status" == 200 ]] || fail "failed rollback did not return its documented response"
jq -e --arg sha "$unknown_sha" '.operation == "rollback" and .result == "failure" and .commitSHA == $sha' \
  "$work_dir/unknown-rollback.json" >/dev/null
assert_sentinel A
controller_get "$controller_id" "/api/v1/applications/$app_name/history?limit=100" >"$work_dir/history-before-restore.json"
assert_history_record "$work_dir/history-before-restore.json" rollback failure "$unknown_sha"

docker_drill stop -t 15 "$controller_id" >/dev/null
[[ "$(docker_drill inspect --format '{{.State.Running}}' "$controller_id")" == false ]] || fail "original controller did not stop"
mkdir -p "$work_dir/snapshot"
docker_drill cp "$controller_id:/data/." "$work_dir/snapshot"
run_verifier \
  --database "$work_dir/snapshot/dockercd.db" --application "$app_name" \
  --sha-a "$sha_a" --sha-b "$sha_b" --unknown-sha "$unknown_sha" \
  --write-restore-baseline "$work_dir/restore-baseline.json" >"$evidence_dir/snapshot-verification.json"

restored_id="$(create_controller "$restored_name" "$restore_volume")"
printf 'restored_id=%s\n' "$restored_id" >>"$evidence_dir/objects.env"
docker_drill cp "$work_dir/snapshot/." "$restored_id:/data/"
docker_drill cp "$token_file" "$restored_id:/run/drill-token"
docker_drill start "$restored_id" >/dev/null
wait_ready "$restored_id"
controller_get "$restored_id" "/api/v1/applications/$app_name/history?limit=100" >"$work_dir/history-after-restore.json"
jq -e --slurpfile before "$work_dir/history-before-restore.json" '
  .items as $after | $before[0].items as $before |
  all($before[]; .id as $id | any($after[]; .id == $id)) and
  all($after[]; .id as $id |
    (any($before[]; .id == $id)) or (.operation == "poll" and .result == "skipped"))
' "$work_dir/history-after-restore.json" >/dev/null
controller_get "$restored_id" "/api/v1/applications/$app_name" >"$work_dir/app-after-restore.json"
jq -e --arg sha "$sha_a" '.status.lastSyncedSHA == $sha' "$work_dir/app-after-restore.json" >/dev/null
assert_sentinel A
sleep 35
controller_get "$restored_id" "/api/v1/applications/$app_name/history?limit=100" >"$work_dir/history-after-observation.json"
jq -e --slurpfile before "$work_dir/history-before-restore.json" '
  .items as $after | $before[0].items as $before |
  all($before[]; .id as $id | any($after[]; .id == $id)) and
  all($after[]; .id as $id |
    (any($before[]; .id == $id)) or (.operation == "poll" and .result == "skipped"))
' "$work_dir/history-after-observation.json" >/dev/null
assert_sentinel A

# Stop before inspecting the restored database: a copied live WAL database is
# not recovery evidence. The digest-only baseline proves every stopped-snapshot
# record and desired configuration survived; it permits only scheduler poll/
# skipped observations added during the bounded post-restore window.
docker_drill stop -t 15 "$restored_id" >/dev/null
[[ "$(docker_drill inspect --format '{{.State.Running}}' "$restored_id")" == false ]] || fail "restored controller did not stop"
mkdir -p "$work_dir/restored-snapshot"
docker_drill cp "$restored_id:/data/." "$work_dir/restored-snapshot"
run_verifier \
  --database "$work_dir/restored-snapshot/dockercd.db" --application "$app_name" \
  --sha-a "$sha_a" --sha-b "$sha_b" --unknown-sha "$unknown_sha" \
  --compare-restore-baseline "$work_dir/restore-baseline.json" >"$evidence_dir/restore-verification.json"

printf 'run_id=%s\ncontroller_image_id=%s\nweb_image_id=%s\nsha_a=%.12s\nsha_b=%.12s\n' \
  "$run_id" "$DOCKERCD_RECOVERY_CONTROLLER_IMAGE_ID" "$DOCKERCD_RECOVERY_WEB_IMAGE_ID" "$sha_a" "$sha_b" \
  >"$evidence_dir/result.env"
drill_succeeded=true
