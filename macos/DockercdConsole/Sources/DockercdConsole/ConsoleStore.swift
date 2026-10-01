import Foundation
import Combine

@MainActor
final class ConsoleStore: ObservableObject {
    @Published private(set) var profiles: [ControllerProfile]
    @Published var selectedProfileID: UUID? {
        didSet { selectProfile() }
    }
    @Published var session: ConnectionSession?
    @Published var showAddConnection = false
    @Published var errorMessage: String?

    private let profilesKey = "dockercd.console.controller-profiles"
    private let selectionKey = "dockercd.console.selected-controller"
    private let defaults: UserDefaults
    private let credentialStore: any ControllerTokenStore
    private var applicationIsActive = true
    private var sessions: [UUID: ConnectionSession] = [:]

    init(
        defaults: UserDefaults = .standard,
        credentialStore: any ControllerTokenStore = KeychainControllerTokenStore()
    ) {
        self.defaults = defaults
        self.credentialStore = credentialStore
        if let data = defaults.data(forKey: profilesKey),
           let decoded = try? JSONDecoder.dockercd.decode([ControllerProfile].self, from: data) {
            profiles = decoded.map { profile in
                guard let legacyToken = profile.token else {
                    return profile
                }
                do {
                    try credentialStore.store(legacyToken, for: profile.id)
                    return profile.withoutToken.withCredentialRecoveryRequired(false)
                } catch {
                    // Never retain a bearer in preferences. The persisted
                    // recovery marker blocks automatic activity until the
                    // user explicitly re-enters a token or removes the profile.
                    return profile.withoutToken.withCredentialRecoveryRequired(true)
                }
            }
        } else {
            profiles = [
                ControllerProfile(name: "Development", baseURL: "http://127.0.0.1:8080"),
                ControllerProfile(name: "My Apps", baseURL: "http://127.0.0.1:8090")
            ]
        }
        selectedProfileID = defaults.string(forKey: selectionKey).flatMap(UUID.init(uuidString:)) ?? profiles.first?.id
        persistProfiles()
        selectProfile()
    }

    var selectedProfile: ControllerProfile? {
        profiles.first { $0.id == selectedProfileID }
    }

    @discardableResult
    func save(profile: ControllerProfile) -> Bool {
        let persistedProfile: ControllerProfile
        do {
            let token = profile.token?.trimmingCharacters(in: .whitespacesAndNewlines)
            if profile.credentialRecoveryRequired && (token == nil || token?.isEmpty == true) {
                errorMessage = "Re-enter the controller token to repair this connection, or remove the profile."
                return false
            }
            if let token, !token.isEmpty {
                try credentialStore.store(token, for: profile.id)
            } else {
                try credentialStore.deleteToken(for: profile.id)
            }
            persistedProfile = profile.withoutToken.withCredentialRecoveryRequired(false)
        } catch {
            errorMessage = "Connection was not saved. \(error.localizedDescription)"
            return false
        }

        if let index = profiles.firstIndex(where: { $0.id == persistedProfile.id }) {
            profiles[index] = persistedProfile
        } else {
            profiles.append(persistedProfile)
        }
        persistProfiles()
        selectedProfileID = persistedProfile.id
        return true
    }

    @discardableResult
    func delete(profile: ControllerProfile) -> Bool {
        guard profiles.count > 1 else {
            errorMessage = "Keep at least one controller profile. Edit its address instead."
            return false
        }
        do {
            try credentialStore.deleteToken(for: profile.id)
        } catch {
            errorMessage = "Connection was not deleted. \(error.localizedDescription)"
            return false
        }
        profiles.removeAll { $0.id == profile.id }
        sessions.removeValue(forKey: profile.id)?.stop()
        persistProfiles()
        if selectedProfileID == profile.id {
            selectedProfileID = profiles.first?.id
        }
        return true
    }

    func setApplicationActive(_ active: Bool) {
        applicationIsActive = active
        session?.setApplicationActive(active)
    }

    func setRefreshMode(_ mode: RefreshMode, for profile: ControllerProfile) {
        var updated = profile
        updated.refreshMode = mode
        save(profile: updated)
    }

    private func selectProfile() {
        session?.stop()
        guard let profile = selectedProfile else {
            session = nil
            return
        }
        defaults.set(profile.id.uuidString, forKey: selectionKey)
        guard !profile.credentialRecoveryRequired,
              let sessionProfile = profileForSession(profile) else {
            session = nil
            return
        }
        let selectedSession: ConnectionSession
        if let existing = sessions[profile.id] {
            existing.update(profile: sessionProfile)
            selectedSession = existing
        } else {
            selectedSession = ConnectionSession(profile: sessionProfile)
            sessions[profile.id] = selectedSession
        }
        selectedSession.setApplicationActive(applicationIsActive)
        self.session = selectedSession
    }

    private func persistProfiles() {
        guard let data = try? JSONEncoder.dockercd.encode(profiles) else { return }
        defaults.set(data, forKey: profilesKey)
    }

    private func profileForSession(_ profile: ControllerProfile) -> ControllerProfile? {
        do {
            return profile.withToken(try credentialStore.token(for: profile.id))
        } catch {
            markCredentialRecoveryRequired(profile)
            return nil
        }
    }

    private func markCredentialRecoveryRequired(_ profile: ControllerProfile) {
        guard let index = profiles.firstIndex(where: { $0.id == profile.id }) else { return }
        profiles[index] = profile.withCredentialRecoveryRequired(true)
        persistProfiles()
    }
}

@MainActor
final class ConnectionSession: ObservableObject {
    @Published private(set) var profile: ControllerProfile
    @Published private(set) var state: ConnectionState = .disconnected
    @Published private(set) var applications: [ApplicationSummary] = []
    @Published private(set) var lastRefresh: Date?
    @Published private(set) var eventStreamConnected = false
    @Published private(set) var refreshInProgress = false
    @Published private(set) var currentError: String?

    private var pollingTask: Task<Void, Never>?
    private var eventTask: Task<Void, Never>?
    private var pendingRefresh = false
    private var failureCount = 0
    private var streamFailureCount = 0
    private var appIsActive = true
    private let apiFactory: (ControllerProfile) throws -> any DockercdAPI

    init(
        profile: ControllerProfile,
        apiFactory: @escaping (ControllerProfile) throws -> any DockercdAPI = { try URLSessionDockercdAPI(profile: $0) }
    ) {
        self.profile = profile
        self.apiFactory = apiFactory
    }

    deinit {
        pollingTask?.cancel()
        eventTask?.cancel()
    }

    func start() {
        stop()
        guard appIsActive else { return }
        pollingTask = Task { [weak self] in
            await self?.runPolling()
        }
        if profile.refreshMode == .live {
            startEventStream()
        }
    }

    func stop() {
        pollingTask?.cancel()
        pollingTask = nil
        eventTask?.cancel()
        eventTask = nil
        eventStreamConnected = false
        state = .disconnected
    }

    func update(profile: ControllerProfile) {
        self.profile = profile
        start()
    }

    func setApplicationActive(_ active: Bool) {
        appIsActive = active
        if active {
            start()
        } else {
            stop()
        }
    }

    func setRefreshMode(_ mode: RefreshMode) {
        profile.refreshMode = mode
        start()
    }

    func refresh() async {
        guard !refreshInProgress else {
            pendingRefresh = true
            return
        }
        refreshInProgress = true
        state = .connecting
        defer {
            refreshInProgress = false
            if pendingRefresh {
                pendingRefresh = false
                Task { await self.refresh() }
            }
        }

        do {
            let api = try api()
            _ = try await api.health()
            let items = try await api.listApplications()
            applications = items.sorted { $0.metadata.name.localizedCaseInsensitiveCompare($1.metadata.name) == .orderedAscending }
            lastRefresh = Date()
            failureCount = 0
            currentError = nil
            state = .connected
        } catch {
            failureCount += 1
            currentError = error.localizedDescription
            state = .degraded(message: error.localizedDescription, lastSuccess: lastRefresh)
        }
    }

    func api() throws -> any DockercdAPI {
        try apiFactory(profile)
    }

    func application(named name: String) -> ApplicationSummary? {
        applications.first { $0.metadata.name == name }
    }

    private func runPolling() async {
        await refresh()
        while !Task.isCancelled {
            guard let baseInterval = profile.refreshMode.pollingInterval else { return }
            let interval = failureCount == 0 ? baseInterval : retryDelay(for: failureCount)
            do {
                try await Task.sleep(for: .seconds(interval))
            } catch {
                return
            }
            guard appIsActive else { return }
            await refresh()
        }
    }

    private func retryDelay(for failures: Int) -> TimeInterval {
        let steps: [TimeInterval] = [5, 10, 30, 60]
        return steps[min(max(failures, 1) - 1, steps.count - 1)]
    }

    private func startEventStream() {
        eventTask?.cancel()
        eventTask = Task { [weak self] in
            guard let self else { return }
            while !Task.isCancelled, self.appIsActive, self.profile.refreshMode == .live {
                do {
                    let api = try self.api()
                    self.eventStreamConnected = true
                    try await api.streamEvents { [weak self] event in
                        await self?.handle(event: event)
                    }
                    self.eventStreamConnected = false
                } catch is CancellationError {
                    return
                } catch {
                    self.eventStreamConnected = false
                    self.streamFailureCount += 1
                    self.currentError = "Live updates paused: \(error.localizedDescription)"
                    do {
                        try await Task.sleep(for: .seconds(self.retryDelay(for: self.streamFailureCount)))
                    } catch {
                        return
                    }
                }
            }
        }
    }

    private func handle(event: StreamEvent) async {
        streamFailureCount = 0
        guard !refreshInProgress else {
            pendingRefresh = true
            return
        }
        guard let appName = event.appName, !appName.isEmpty else {
            await refresh()
            return
        }
        do {
            let updated = try await api().application(named: appName)
            if let index = applications.firstIndex(where: { $0.id == appName }) {
                applications[index] = updated
            } else {
                await refresh()
            }
            lastRefresh = Date()
        } catch {
            // A deleted application or a transient event race is reconciled by
            // the normal, bounded list refresh.
            await refresh()
        }
    }
}
