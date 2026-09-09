import Foundation

protocol DockercdAPI: Sendable {
    func health() async throws -> HealthResponse
    func capabilities() async throws -> CapabilitiesResponse
    func listApplications() async throws -> [ApplicationSummary]
    func application(named name: String) async throws -> ApplicationSummary
    func createApplication(_ draft: ApplicationDraft) async throws -> ApplicationSummary
    func updateApplication(_ name: String, draft: ApplicationDraft) async throws -> ApplicationSummary
    func deleteApplication(_ name: String) async throws
    func syncApplication(_ name: String) async throws
    func rollbackApplication(_ name: String, sha: String) async throws
    func applicationDiff(_ name: String) async throws -> DiffResult
    func renderedDesired(_ name: String) async throws -> RenderedDesiredResponse
    func history(for name: String) async throws -> [SyncRecord]
    func events(for name: String) async throws -> [EventRecord]
    func serviceLogs(app: String, service: String, tail: Int) async throws -> [String]
    func serviceDetail(app: String, service: String) async throws -> ServiceDetail
    func systemInfo() async throws -> DockerHostInfo?
    func hostStats() async throws -> HostStats?
    func pollInterval() async throws -> PollIntervalResponse
    func setPollInterval(milliseconds: Int64) async throws -> PollIntervalResponse
    func streamEvents(onEvent: @escaping @Sendable (StreamEvent) async -> Void) async throws
}

struct URLSessionDockercdAPI: DockercdAPI {
    private let baseURL: URL
    private let token: String?
    private let session: URLSession

    init(profile: ControllerProfile, session: URLSession = .shared) throws {
        guard let baseURL = profile.normalizedBaseURL,
              let scheme = baseURL.scheme?.lowercased(),
              scheme == "http" || scheme == "https" else {
            throw APIError(statusCode: 0, message: "Enter a valid http:// or https:// controller URL.", code: nil)
        }
        self.baseURL = baseURL
        self.token = profile.token?.trimmingCharacters(in: .whitespacesAndNewlines).nilIfEmpty
        self.session = session
    }

    func health() async throws -> HealthResponse {
        try await request(path: "/healthz")
    }

    func capabilities() async throws -> CapabilitiesResponse {
        try await request(path: "/api/v1/capabilities")
    }

    func listApplications() async throws -> [ApplicationSummary] {
        let response: ListResponse<ApplicationSummary> = try await request(path: "/api/v1/applications")
        return response.items
    }

    func application(named name: String) async throws -> ApplicationSummary {
        try await request(path: "/api/v1/applications/\(name.encodedPathComponent)")
    }

    func createApplication(_ draft: ApplicationDraft) async throws -> ApplicationSummary {
        try await request(method: "POST", path: "/api/v1/applications", body: draft)
    }

    func updateApplication(_ name: String, draft: ApplicationDraft) async throws -> ApplicationSummary {
        try await request(method: "PUT", path: "/api/v1/applications/\(name.encodedPathComponent)", body: draft)
    }

    func deleteApplication(_ name: String) async throws {
        let _: EmptyResponse = try await request(method: "DELETE", path: "/api/v1/applications/\(name.encodedPathComponent)", body: Optional<EmptyBody>.none)
    }

    func syncApplication(_ name: String) async throws {
        let _: EmptyResponse = try await request(method: "POST", path: "/api/v1/applications/\(name.encodedPathComponent)/sync", body: Optional<EmptyBody>.none)
    }

    func rollbackApplication(_ name: String, sha: String) async throws {
        struct Rollback: Encodable { let targetSHA: String }
        let _: EmptyResponse = try await request(
            method: "POST",
            path: "/api/v1/applications/\(name.encodedPathComponent)/rollback",
            body: Rollback(targetSHA: sha)
        )
    }

    func applicationDiff(_ name: String) async throws -> DiffResult {
        try await request(path: "/api/v1/applications/\(name.encodedPathComponent)/diff")
    }

    func renderedDesired(_ name: String) async throws -> RenderedDesiredResponse {
        try await request(path: "/api/v1/applications/\(name.encodedPathComponent)/desired")
    }

    func history(for name: String) async throws -> [SyncRecord] {
        let response: ListResponse<SyncRecord> = try await request(path: "/api/v1/applications/\(name.encodedPathComponent)/history?limit=100")
        return response.items
    }

    func events(for name: String) async throws -> [EventRecord] {
        let response: ListResponse<EventRecord> = try await request(path: "/api/v1/applications/\(name.encodedPathComponent)/events?limit=100")
        return response.items
    }

    func serviceLogs(app: String, service: String, tail: Int = 200) async throws -> [String] {
        let response: ServiceLogsResponse = try await request(
            path: "/api/v1/applications/\(app.encodedPathComponent)/services/\(service.encodedPathComponent)/logs?tail=\(min(max(tail, 1), 5_000))"
        )
        return response.lines
    }

    func serviceDetail(app: String, service: String) async throws -> ServiceDetail {
        try await request(path: "/api/v1/applications/\(app.encodedPathComponent)/services/\(service.encodedPathComponent)")
    }

    func systemInfo() async throws -> DockerHostInfo? {
        let response: SystemInfoResponse = try await request(path: "/api/v1/system")
        return response.host
    }

    func hostStats() async throws -> HostStats? {
        let response: HostStatsResponse = try await request(path: "/api/v1/system/stats")
        return response.stats
    }

    func pollInterval() async throws -> PollIntervalResponse {
        try await request(path: "/api/v1/settings/poll-interval")
    }

    func setPollInterval(milliseconds: Int64) async throws -> PollIntervalResponse {
        struct PollIntervalRequest: Encodable { let intervalMs: Int64 }
        return try await request(
            method: "PUT",
            path: "/api/v1/settings/poll-interval",
            body: PollIntervalRequest(intervalMs: milliseconds)
        )
    }

    func streamEvents(onEvent: @escaping @Sendable (StreamEvent) async -> Void) async throws {
        var request = try makeRequest(path: "/api/v1/events/stream", method: "GET")
        request.setValue("text/event-stream", forHTTPHeaderField: "Accept")
        let (bytes, response) = try await session.bytes(for: request)
        try validate(response)

        var eventType = "message"
        for try await line in bytes.lines {
            if Task.isCancelled { return }
            if line.hasPrefix("event:") {
                eventType = String(line.dropFirst(6)).trimmingCharacters(in: .whitespaces)
                continue
            }
            guard line.hasPrefix("data:") else { continue }
            let payload = String(line.dropFirst(5)).trimmingCharacters(in: .whitespaces)
            guard let data = payload.data(using: .utf8) else { continue }
            var event = try? JSONDecoder.dockercd.decode(StreamEvent.self, from: data)
            if event == nil {
                event = StreamEvent(type: eventType, appName: nil, timestamp: Date())
            }
            if var event {
                event = StreamEvent(type: event.type.isEmpty ? eventType : event.type, appName: event.appName, timestamp: event.timestamp)
                await onEvent(event)
            }
        }
    }

    private func request<Response: Decodable>(path: String) async throws -> Response {
        try await request(method: "GET", path: path, body: Optional<EmptyBody>.none)
    }

    private func request<Response: Decodable, Body: Encodable>(
        method: String,
        path: String,
        body: Body? = nil
    ) async throws -> Response {
        var request = try makeRequest(path: path, method: method)
        if let body {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try JSONEncoder.dockercd.encode(body)
        }
        let (data, response) = try await session.data(for: request)
        try validate(response, data: data)
        if Response.self == EmptyResponse.self {
            return EmptyResponse() as! Response
        }
        do {
            return try JSONDecoder.dockercd.decode(Response.self, from: data)
        } catch {
            throw APIError(statusCode: 0, message: "The controller returned an unreadable response: \(error.localizedDescription)", code: nil)
        }
    }

    private func makeRequest(path: String, method: String) throws -> URLRequest {
        guard let url = URL(string: path, relativeTo: baseURL)?.absoluteURL else {
            throw APIError(statusCode: 0, message: "Could not build controller request URL.", code: nil)
        }
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.timeoutInterval = 15
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if let token {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        return request
    }

    private func validate(_ response: URLResponse, data: Data = Data()) throws {
        guard let http = response as? HTTPURLResponse else {
            throw APIError(statusCode: 0, message: "The controller did not return an HTTP response.", code: nil)
        }
        guard (200..<300).contains(http.statusCode) else {
            let body = try? JSONDecoder.dockercd.decode(APIErrorBody.self, from: data)
            throw APIError(
                statusCode: http.statusCode,
                message: body?.error ?? "Controller request failed (HTTP \(http.statusCode)).",
                code: body?.code
            )
        }
    }
}

private struct APIErrorBody: Decodable {
    let error: String
    let code: String?
}

private struct EmptyResponse: Decodable { }
private struct EmptyBody: Encodable { }

private extension String {
    var encodedPathComponent: String {
        addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? self
    }

    var nilIfEmpty: String? { isEmpty ? nil : self }
}
