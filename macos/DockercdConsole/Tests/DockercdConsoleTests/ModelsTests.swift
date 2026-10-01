import XCTest
@testable import DockercdConsole

final class ModelsTests: XCTestCase {
    func testProfileNormalizesTrailingSlash() {
        let profile = ControllerProfile(name: "Test", baseURL: "http://controller.example:8080/")
        XCTAssertEqual(profile.normalizedBaseURL?.absoluteString, "http://controller.example:8080")
    }

    func testControllerProfileRequiresBareHTTPOrigin() {
        let valid = ControllerProfile(name: "Test", baseURL: "https://controller.example:8443/")
        XCTAssertEqual(valid.normalizedBaseURL?.absoluteString, "https://controller.example:8443")

        [
            "ftp://controller.example",
            "https://",
            "https://user:password@controller.example",
            "https://controller.example/api/v1",
            "https://controller.example?token=secret",
            "https://controller.example#fragment"
        ].forEach { baseURL in
            let profile = ControllerProfile(name: "Test", baseURL: baseURL)
            XCTAssertNil(profile.normalizedBaseURL, "Expected an invalid controller origin: \(baseURL)")
        }
    }

    func testControllerProfileAcceptsLocalhostIPv4AndIPv6Origins() {
        [
            "http://localhost:8080",
            "http://127.0.0.1:8080",
            "https://[::1]:8443"
        ].forEach { baseURL in
            let profile = ControllerProfile(name: "Test", baseURL: baseURL)
            XCTAssertEqual(profile.normalizedBaseURL?.absoluteString, baseURL)
        }
    }

    func testControllerProfileRejectsEmptyHostsEncodedPathsAndInvalidPorts() {
        [
            "https://:8443",
            "https://controller.example/%2Fapi",
            "https://controller.example/%2e%2e",
            "https://controller.example:0",
            "https://controller.example:65536"
        ].forEach { baseURL in
            let profile = ControllerProfile(name: "Test", baseURL: baseURL)
            XCTAssertNil(profile.normalizedBaseURL, "Expected an invalid controller origin: \(baseURL)")
        }
    }

    func testControllerRejectsUnsafeProfileBeforeStartingNetworkWork() throws {
        let profile = ControllerProfile(
            name: "Test",
            baseURL: "https://token:secret@controller.example"
        )

        XCTAssertThrowsError(try URLSessionDockercdAPI(profile: profile)) { error in
            XCTAssertEqual(
                error as? APIError,
                APIError(
                    statusCode: 0,
                    message: "Enter a controller http:// or https:// origin without credentials, paths, queries, or fragments.",
                    code: nil
                )
            )
        }
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

    func testControllerRedirectIsReportedInsteadOfFollowed() async throws {
        RedirectingURLProtocol.recorder.reset()
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [RedirectingURLProtocol.self]
        let session = URLSessionDockercdAPI.makeRedirectRejectingSession(configuration: configuration)
        let profile = ControllerProfile(
            name: "Fixture",
            baseURL: "https://controller.example",
            token: "synthetic-bearer"
        )
        let api = try URLSessionDockercdAPI(profile: profile, session: session)

        do {
            _ = try await api.health()
            XCTFail("A redirected controller request must not be accepted.")
        } catch let error as APIError {
            XCTAssertEqual(error.statusCode, 302)
        }

        let snapshot = RedirectingURLProtocol.recorder.snapshot()
        XCTAssertEqual(snapshot.redirectTargets, ["https://redirected.example/healthz"])
        XCTAssertEqual(snapshot.requests.map(\.url), ["https://controller.example/healthz"])
        XCTAssertEqual(snapshot.requests.first?.authorization, "Bearer synthetic-bearer")
        XCTAssertFalse(snapshot.requests.contains {
            $0.url == "https://redirected.example/healthz" &&
            $0.authorization == "Bearer synthetic-bearer"
        })
    }
}

private final class RedirectingURLProtocol: URLProtocol {
    static let recorder = RedirectRequestRecorder()

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        Self.recorder.record(request)
        if request.url?.host == "controller.example" {
            let redirectURL = URL(string: "https://redirected.example/healthz")!
            let response = HTTPURLResponse(
                url: request.url!,
                statusCode: 302,
                httpVersion: "HTTP/1.1",
                headerFields: ["Location": redirectURL.absoluteString]
            )!
            var redirectRequest = request
            redirectRequest.url = redirectURL
            Self.recorder.recordRedirect(to: redirectURL)
            client?.urlProtocol(self, wasRedirectedTo: redirectRequest, redirectResponse: response)
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocolDidFinishLoading(self)
            return
        }

        let data = Data(#"{\"status\":\"ok\"}"#.utf8)
        let response = HTTPURLResponse(
            url: request.url!,
            statusCode: 200,
            httpVersion: "HTTP/1.1",
            headerFields: ["Content-Type": "application/json"]
        )!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: data)
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}
}

private final class RedirectRequestRecorder: @unchecked Sendable {
    struct Request: Equatable {
        let url: String
        let authorization: String?
    }

    struct Snapshot {
        let requests: [Request]
        let redirectTargets: [String]
    }

    private let lock = NSLock()
    private var requests: [Request] = []
    private var redirectTargets: [String] = []

    func reset() {
        lock.withLock {
            requests = []
            redirectTargets = []
        }
    }

    func record(_ request: URLRequest) {
        lock.withLock {
            requests.append(Request(
                url: request.url?.absoluteString ?? "",
                authorization: request.value(forHTTPHeaderField: "Authorization")
            ))
        }
    }

    func recordRedirect(to url: URL) {
        lock.withLock {
            redirectTargets.append(url.absoluteString)
        }
    }

    func snapshot() -> Snapshot {
        lock.withLock { Snapshot(requests: requests, redirectTargets: redirectTargets) }
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
