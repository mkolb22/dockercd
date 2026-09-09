import Foundation

enum RefreshMode: String, Codable, CaseIterable, Identifiable {
    case live
    case everyFiveSeconds
    case everyTenSeconds
    case manual

    var id: String { rawValue }

    var title: String {
        switch self {
        case .live: "Live"
        case .everyFiveSeconds: "Every 5 seconds"
        case .everyTenSeconds: "Every 10 seconds"
        case .manual: "Manual"
        }
    }

    var pollingInterval: TimeInterval? {
        switch self {
        case .live: 30
        case .everyFiveSeconds: 5
        case .everyTenSeconds: 10
        case .manual: nil
        }
    }
}

enum ConnectionState: Equatable {
    case disconnected
    case connecting
    case connected
    case degraded(message: String, lastSuccess: Date?)

    var title: String {
        switch self {
        case .disconnected: "Disconnected"
        case .connecting: "Connecting"
        case .connected: "Connected"
        case .degraded: "Degraded"
        }
    }
}

struct ControllerProfile: Identifiable, Codable, Hashable {
    var id: UUID
    var name: String
    var baseURL: String
    var refreshMode: RefreshMode
    var token: String?

    init(
        id: UUID = UUID(),
        name: String,
        baseURL: String,
        refreshMode: RefreshMode = .everyTenSeconds,
        token: String? = nil
    ) {
        self.id = id
        self.name = name
        self.baseURL = baseURL
        self.refreshMode = refreshMode
        self.token = token
    }

    var normalizedBaseURL: URL? {
        let trimmed = baseURL.trimmingCharacters(in: .whitespacesAndNewlines)
            .trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        return URL(string: trimmed)
    }

    var isInsecureHTTP: Bool {
        normalizedBaseURL?.scheme?.lowercased() == "http"
    }
}

struct APIError: LocalizedError, Equatable {
    let statusCode: Int
    let message: String
    let code: String?

    var errorDescription: String? { message }
}

struct HealthResponse: Codable, Equatable {
    let status: String
}

struct CapabilitiesResponse: Codable, Equatable {
    let apiVersion: String
    let features: [String]
}

struct ListResponse<Item: Codable>: Codable {
    let items: [Item]
    let total: Int
}

struct ApplicationSummary: Identifiable, Codable, Equatable {
    let metadata: ApplicationMetadata
    let spec: ApplicationSpec
    let status: ApplicationStatus
    let recentHistory: [SyncRecord]?

    var id: String { metadata.name }
}

struct ApplicationMetadata: Codable, Equatable {
    let name: String
}

struct ApplicationSpec: Codable, Equatable {
    let source: SourceSpec
    let destination: DestinationSpec
    let syncPolicy: SyncPolicy
}

struct SourceSpec: Codable, Equatable {
    let repoURL: String
    let targetRevision: String
    let path: String
    let composeFiles: [String]
}

struct DestinationSpec: Codable, Equatable {
    let dockerHost: String
    let projectName: String
}

struct SyncPolicy: Codable, Equatable {
    let automated: Bool
    let prune: Bool
    let selfHeal: Bool
    let pollInterval: String?
    let syncTimeout: String?
    let healthTimeout: String?
}

struct ApplicationStatus: Codable, Equatable {
    let syncStatus: String
    let healthStatus: String
    let lastSyncedSHA: String?
    let headSHA: String?
    let lastSyncTime: String?
    let lastError: String?
    let services: [ServiceStatus]?
}

struct ServiceStatus: Codable, Identifiable, Equatable {
    let name: String
    let image: String
    let health: String
    let state: String
    let ports: [PortMapping]?
    let metrics: ContainerMetrics?

    var id: String { name }
}

struct PortMapping: Codable, Equatable {
    let hostPort: String
    let containerPort: String
    let protocolName: String

    enum CodingKeys: String, CodingKey {
        case hostPort, containerPort
        case protocolName = "protocol"
    }
}

struct ContainerMetrics: Codable, Equatable {
    let cpuPercent: Double
    let memoryUsageMB: Double
    let memoryLimitMB: Double
    let memoryPercent: Double
    let networkRxMB: Double
    let networkTxMB: Double
    let pids: Int
    let uptime: String
}

struct SyncRecord: Codable, Identifiable, Equatable {
    let id: String
    let appName: String
    let startedAt: Date
    let finishedAt: Date?
    let commitSHA: String?
    let operation: String
    let result: String
    let error: String?
    let durationMs: Int64?
}

struct EventRecord: Codable, Identifiable, Equatable {
    let id: String
    let appName: String
    let type: String
    let message: String
    let severity: String
    let createdAt: Date
}

struct DiffResult: Codable, Equatable {
    let inSync: Bool
    let toCreate: [ServiceDiff]?
    let toUpdate: [ServiceDiff]?
    let toRemove: [ServiceDiff]?
    let summary: String
}

struct RenderedDesiredResponse: Codable, Equatable {
    let appName: String
    let headSHA: String
    let compose: ComposeSpec?
}

struct ComposeSpec: Codable, Equatable {
    let services: [DesiredService]
}

struct DesiredService: Codable, Identifiable, Equatable {
    let name: String
    let image: String
    let command: [String]?
    let environment: [String: String]?

    var id: String { name }
}

struct ServiceDiff: Codable, Identifiable, Equatable {
    let serviceName: String
    let changeType: String
    let fields: [FieldDiff]?

    var id: String { "\(changeType)-\(serviceName)" }
}

struct FieldDiff: Codable, Equatable {
    let field: String
    let desired: String
    let live: String
}

struct SystemInfoResponse: Codable, Equatable {
    let host: DockerHostInfo?
}

struct DockerHostInfo: Codable, Equatable {
    let serverVersion: String
    let os: String
    let architecture: String
    let kernelVersion: String
    let totalMemoryMB: Int64
    let cpus: Int
    let containers: Int
    let containersRunning: Int
    let images: Int
}

struct HostStatsResponse: Codable, Equatable {
    let stats: HostStats?
}

struct HostStats: Codable, Equatable {
    let cpuPercent: Double
    let memoryUsageMB: Double
    let memoryLimitMB: Double
    let memoryPercent: Double
    let containersRunning: Int
    let containersTotal: Int
    let collectedAt: String
}

struct PollIntervalResponse: Codable, Equatable {
    let intervalMs: Int64
}

struct ServiceDetail: Codable, Equatable {
    let name: String
    let image: String
    let containerName: String?
    let status: String?
    let health: String
    let containerId: String
    let metrics: ContainerMetrics?
    let ports: [PortMapping]?
}

struct ServiceLogsResponse: Codable, Equatable {
    let lines: [String]
}

struct StreamEvent: Codable, Equatable {
    let type: String
    let appName: String?
    let timestamp: Date
}

struct ApplicationDraft: Encodable {
    let apiVersion = "dockercd/v1"
    let kind = "Application"
    var metadata: ApplicationMetadata
    var spec: ApplicationSpec
}

extension JSONDecoder {
    static var dockercd: JSONDecoder {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return decoder
    }
}

extension JSONEncoder {
    static var dockercd: JSONEncoder {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        return encoder
    }
}
