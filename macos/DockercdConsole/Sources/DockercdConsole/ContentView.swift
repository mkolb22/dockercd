import SwiftUI

struct ContentView: View {
    @EnvironmentObject private var store: ConsoleStore

    var body: some View {
        NavigationSplitView {
            List(selection: $store.selectedProfileID) {
                Section("Controllers") {
                    ForEach(store.profiles) { profile in
                        ControllerRow(profile: profile, isSelected: profile.id == store.selectedProfileID)
                            .tag(profile.id)
                            .contextMenu {
                                Button(role: .destructive) {
                                    store.delete(profile: profile)
                                } label: {
                                    Label("Delete Controller", systemImage: "trash")
                                }
                            }
                    }
                }
            }
            .navigationTitle("dockercd")
            .toolbar {
                ToolbarItem {
                    Button {
                        store.showAddConnection = true
                    } label: {
                        Label("Add Controller", systemImage: "plus")
                    }
                }
            }
        } detail: {
            if let session = store.session {
                ControllerWorkspace(session: session)
                    .id(session.profile.id)
            } else {
                ContentUnavailableView("No Controller Selected", systemImage: "server.rack")
            }
        }
        .sheet(isPresented: $store.showAddConnection) {
            ConnectionEditor { profile in
                store.save(profile: profile)
                store.showAddConnection = false
            }
        }
        .alert("dockercd Console", isPresented: Binding(
            get: { store.errorMessage != nil },
            set: { if !$0 { store.errorMessage = nil } }
        )) {
            Button("OK", role: .cancel) { store.errorMessage = nil }
        } message: {
            Text(store.errorMessage ?? "")
        }
    }
}

private struct ControllerRow: View {
    let profile: ControllerProfile
    let isSelected: Bool

    var body: some View {
        HStack(spacing: 9) {
            Image(systemName: profile.isInsecureHTTP ? "exclamationmark.triangle.fill" : "server.rack")
                .font(.caption.weight(.bold))
                .foregroundStyle(profile.isInsecureHTTP ? CommandCenterPalette.amber : CommandCenterPalette.indigo)
                .frame(width: 25, height: 25)
                .background((profile.isInsecureHTTP ? CommandCenterPalette.amber : CommandCenterPalette.indigo).opacity(0.12), in: RoundedRectangle(cornerRadius: 8, style: .continuous))
            VStack(alignment: .leading, spacing: 3) {
                Text(profile.name)
                    .fontWeight(isSelected ? .semibold : .regular)
                Text(profile.baseURL)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
        }
    }
}

struct ControllerWorkspace: View {
    @EnvironmentObject private var store: ConsoleStore
    @ObservedObject var session: ConnectionSession

    var body: some View {
        VStack(spacing: 0) {
            ControllerHeader(session: session)
            Divider()
            TabView {
                DashboardView(session: session)
                    .tabItem { Label("Dashboard", systemImage: "rectangle.3.group") }
                ApplicationsWorkspace(session: session)
                    .tabItem { Label("Applications", systemImage: "square.grid.2x2") }
                SystemView(session: session)
                    .tabItem { Label("System", systemImage: "cpu") }
                ControllerSettingsView(session: session)
                    .tabItem { Label("Settings", systemImage: "gearshape") }
            }
            .padding(.top, 6)
        }
        .navigationTitle(session.profile.name)
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button {
                    Task { await session.refresh() }
                } label: {
                    Label("Refresh", systemImage: "arrow.clockwise")
                }
                .disabled(session.refreshInProgress)
            }
        }
    }
}

private struct ControllerHeader: View {
    @EnvironmentObject private var store: ConsoleStore
    @ObservedObject var session: ConnectionSession

    var body: some View {
        HStack(spacing: 14) {
            Circle()
                .fill(stateColor)
                .frame(width: 9, height: 9)
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 6) {
                    Text(session.profile.name).font(.headline)
                    Text(session.state.title)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Text(session.profile.baseURL)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Spacer()
            if session.profile.isInsecureHTTP {
                Label("Trusted network HTTP", systemImage: "exclamationmark.triangle")
                    .font(.caption)
                    .foregroundStyle(CommandCenterPalette.amber)
            }
            Picker("Refresh", selection: Binding(
                get: { session.profile.refreshMode },
                set: { store.setRefreshMode($0, for: session.profile) }
            )) {
                ForEach(RefreshMode.allCases) { mode in
                    Text(mode.title).tag(mode)
                }
            }
            .labelsHidden()
            .frame(width: 145)
            if let lastRefresh = session.lastRefresh {
                Text("Updated \(lastRefresh, style: .relative)")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .padding(.horizontal, 22)
        .padding(.vertical, 14)
    }

    private var stateColor: Color {
        switch session.state {
        case .connected: .green
        case .connecting: .orange
        case .degraded: .red
        case .disconnected: .gray
        }
    }
}

struct ConnectionEditor: View {
    @Environment(\.dismiss) private var dismiss
    @State private var profile: ControllerProfile
    @State private var testState = ""
    @State private var isTesting = false
    let onSave: (ControllerProfile) -> Void

    init(profile: ControllerProfile? = nil, onSave: @escaping (ControllerProfile) -> Void) {
        _profile = State(initialValue: profile ?? ControllerProfile(name: "", baseURL: "http://"))
        self.onSave = onSave
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            Text("Controller Connection")
                .font(.title2.bold())
            Form {
                TextField("Name", text: $profile.name)
                TextField("Base URL", text: $profile.baseURL)
                    .textContentType(.URL)
                Picker("Default refresh", selection: $profile.refreshMode) {
                    ForEach(RefreshMode.allCases) { mode in
                        Text(mode.title).tag(mode)
                    }
                }
                SecureField("API token (optional for now)", text: Binding(
                    get: { profile.token ?? "" },
                    set: { profile.token = $0.nilIfEmpty }
                ))
            }
            if !testState.isEmpty {
                Text(testState)
                    .font(.caption)
                    .foregroundStyle(testState.hasPrefix("Connected") ? .green : .red)
            }
            HStack {
                Button("Test Connection") {
                    Task { await testConnection() }
                }
                .disabled(isTesting)
                Spacer()
                Button("Cancel") { dismiss() }
                Button("Save") {
                    onSave(profile)
                }
                .buttonStyle(.borderedProminent)
                .disabled(profile.name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || profile.normalizedBaseURL == nil)
            }
        }
        .padding(24)
        .frame(width: 500)
    }

    private func testConnection() async {
        isTesting = true
        defer { isTesting = false }
        do {
            let api = try URLSessionDockercdAPI(profile: profile)
            let health = try await api.health()
            do {
                let capabilities = try await api.capabilities()
                testState = "Connected — \(health.status), API \(capabilities.apiVersion), \(capabilities.features.count) features."
            } catch let error as APIError where error.statusCode == 404 {
                testState = "Connected — controller reports \(health.status) (legacy v1 capability endpoint unavailable)."
            } catch {
                testState = "Connected — controller reports \(health.status), but feature discovery failed: \(error.localizedDescription)"
            }
        } catch {
            testState = error.localizedDescription
        }
    }
}

private extension String {
    var nilIfEmpty: String? {
        let value = trimmingCharacters(in: .whitespacesAndNewlines)
        return value.isEmpty ? nil : value
    }
}
