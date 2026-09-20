#!/usr/bin/env bash
# Static fixture guardrails. This deliberately does not contact Docker or Git.
set -euo pipefail

root="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
fixtures="$root/scripts/testdata/recovery-drill"

bash -n "$fixtures/git-http-backend"

rendered_manifest="$(sed \
  -e 's/__APP_NAME__/dockercd-drill-test/g' \
  -e 's/__PROJECT_NAME__/dockercd-drill-test/g' \
  "$fixtures/application.json.in")"
printf '%s\n' "$rendered_manifest" | jq -e '
  .apiVersion == "dockercd/v1" and
  .kind == "Application" and
  .spec.source.repoURL == "http://git-fixture:8080/cgi-bin/git/repo.git" and
  .spec.source.targetRevision == "release" and
  .spec.syncPolicy.automated == false and
  .spec.syncPolicy.selfHeal == false and
  .spec.syncPolicy.prune == false
' >/dev/null

for compose in "$fixtures/compose-a.yml.in" "$fixtures/compose-b.yml.in"; do
  ! grep -Eq '^[[:space:]]*(ports|volumes|privileged|container_name|network_mode):' "$compose"
  grep -Fq 'pull_policy: never' "$compose"
  grep -Fq 'alpine@sha256:c3f8e73fdb79deaebaa2037150150191b9dcbfba68b4a46d70103204c53f4709' "$compose"
  grep -Fq 'cpus: "0.10"' "$compose"
  grep -Fq 'memory: 64M' "$compose"
  grep -Fq 'com.dockercd.drill-run: "__RUN_ID__"' "$compose"
done

grep -Fq 'COPY repo.git /srv/git/repo.git' "$fixtures/fixture.Dockerfile"
grep -Fq 'ENTRYPOINT ["busybox", "httpd", "-f", "-p", "8080", "-h", "/www"]' "$fixtures/fixture.Dockerfile"
grep -Fq 'HEALTHCHECK NONE' "$fixtures/fixture.Dockerfile"
grep -Fq 'CMD []' "$fixtures/fixture.Dockerfile"
grep -Fq 'GIT_HTTP_EXPORT_ALL=1' "$fixtures/git-http-backend"
grep -Fq 'GIT_PROJECT_ROOT=/srv/git' "$fixtures/git-http-backend"

source "$root/scripts/recovery-drill-images.env"
[[ "$DOCKERCD_RECOVERY_CONTROLLER_IMAGE_ID" =~ ^sha256:[a-f0-9]{64}$ ]]
[[ "$DOCKERCD_RECOVERY_WEB_IMAGE_ID" =~ ^sha256:[a-f0-9]{64}$ ]]
