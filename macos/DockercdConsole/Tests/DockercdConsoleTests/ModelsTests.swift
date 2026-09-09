import XCTest
@testable import DockercdConsole

final class ModelsTests: XCTestCase {
    func testProfileNormalizesTrailingSlash() {
        let profile = ControllerProfile(name: "Test", baseURL: "http://controller.example:8080/")
        XCTAssertEqual(profile.normalizedBaseURL?.absoluteString, "http://controller.example:8080")
    }

    func testRefreshIntervalsMatchSessionPolicy() {
        XCTAssertEqual(RefreshMode.live.pollingInterval, 30)
        XCTAssertEqual(RefreshMode.everyFiveSeconds.pollingInterval, 5)
        XCTAssertEqual(RefreshMode.everyTenSeconds.pollingInterval, 10)
        XCTAssertNil(RefreshMode.manual.pollingInterval)
    }

    @MainActor
    func testConnectionSessionRefreshesThroughInjectedAPI() async {
        let profile = ControllerProfile(name: "Fixture", baseURL: "https://controller.example")
        let session = ConnectionSession(profile: profile) { _ in MockDockercdAPI() }

        await session.refresh()

        XCTAssertEqual(session.state.title, "Connected")
        XCTAssertEqual(session.applications.map(\.id), ["fixture-app"])
        XCTAssertNotNil(session.lastRefresh)
    }
}

private struct MockDockercdAPI: DockercdAPI {
    private let fixture = ApplicationSummary(
        metadata: ApplicationMetadata(name: "fixture-app"),
        spec: ApplicationSpec(
            source: SourceSpec(repoURL: "https://example.test/repo.git", targetRevision: "main", path: ".", composeFiles: ["compose.yml"]),
            destination: DestinationSpec(dockerHost: "unix:///var/run/docker.sock", projectName: "fixture-app"),
            syncPolicy: SyncPolicy(automated: true, prune: true, selfHeal: true, pollInterval: nil, syncTimeout: nil, healthTimeout: nil)
        ),
        status: ApplicationStatus(syncStatus: "Synced", healthStatus: "Healthy", lastSyncedSHA: nil, headSHA: "abc123", lastSyncTime: nil, lastError: nil, services: []),
        recentHistory: []
    )

    func health() async throws -> HealthResponse { HealthResponse(status: "ok") }
    func capabilities() async throws -> CapabilitiesResponse { CapabilitiesResponse(apiVersion: "v1", features: []) }
    func listApplications() async throws -> [ApplicationSummary] { [fixture] }
    func application(named name: String) async throws -> ApplicationSummary { fixture }
    func createApplication(_ draft: ApplicationDraft) async throws -> ApplicationSummary { fixture }
    func updateApplication(_ name: String, draft: ApplicationDraft) async throws -> ApplicationSummary { fixture }
    func deleteApplication(_ name: String) async throws {}
    func syncApplication(_ name: String) async throws {}
    func rollbackApplication(_ name: String, sha: String) async throws {}
    func applicationDiff(_ name: String) async throws -> DiffResult {
        DiffResult(inSync: true, toCreate: nil, toUpdate: nil, toRemove: nil, summary: "In sync")
    }
    func renderedDesired(_ name: String) async throws -> RenderedDesiredResponse {
        RenderedDesiredResponse(appName: name, headSHA: "abc123", compose: nil)
    }
    func history(for name: String) async throws -> [SyncRecord] { [] }
    func events(for name: String) async throws -> [EventRecord] { [] }
    func serviceLogs(app: String, service: String, tail: Int) async throws -> [String] { [] }
    func serviceDetail(app: String, service: String) async throws -> ServiceDetail {
        ServiceDetail(name: service, image: "fixture", containerName: nil, status: nil, health: "Healthy", containerId: "fixture", metrics: nil, ports: nil)
    }
    func systemInfo() async throws -> DockerHostInfo? { nil }
    func hostStats() async throws -> HostStats? { nil }
    func pollInterval() async throws -> PollIntervalResponse { PollIntervalResponse(intervalMs: 300_000) }
    func setPollInterval(milliseconds: Int64) async throws -> PollIntervalResponse { PollIntervalResponse(intervalMs: milliseconds) }
    func streamEvents(onEvent: @escaping @Sendable (StreamEvent) async -> Void) async throws {}
}
