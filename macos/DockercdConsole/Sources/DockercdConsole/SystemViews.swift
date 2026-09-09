import SwiftUI

struct SystemView: View {
    @ObservedObject var session: ConnectionSession
    @State private var host: DockerHostInfo?
    @State private var stats: HostStats?
    @State private var errorMessage: String?
    @State private var loading = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                HStack {
                    VStack(alignment: .leading, spacing: 4) {
                        Label("HOST TELEMETRY", systemImage: "cpu.fill")
                            .font(.caption.weight(.bold))
                            .foregroundStyle(CommandCenterPalette.indigo)
                        Text("Controller system").font(.system(size: 27, weight: .bold, design: .rounded))
                        Text("A current snapshot from the Docker host—not an invented history chart.")
                            .font(.callout)
                            .foregroundStyle(.secondary)
                    }
                    Spacer()
                    Button("Refresh System") { Task { await refresh() } }
                        .disabled(loading)
                }
                if let host {
                    CommandCenterSurface(tint: CommandCenterPalette.indigo) {
                        HStack(spacing: 16) {
                            Image(systemName: "server.rack")
                                .font(.system(size: 30, weight: .medium))
                                .foregroundStyle(CommandCenterPalette.indigo)
                                .frame(width: 54, height: 54)
                                .background(CommandCenterPalette.indigo.opacity(0.12), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                            VStack(alignment: .leading, spacing: 5) {
                                Text("\(host.os) · \(host.architecture)")
                                    .font(.headline)
                                Text("Docker Engine \(host.serverVersion) · \(host.containersRunning) running containers")
                                    .font(.callout)
                                    .foregroundStyle(.secondary)
                            }
                            Spacer()
                            CommandStatusChip(title: "Connected")
                        }
                        .padding(18)
                    }
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 170), spacing: 12)], spacing: 12) {
                        MetricCard(title: "Docker", value: host.serverVersion, symbol: "shippingbox")
                        MetricCard(title: "Platform", value: "\(host.os) · \(host.architecture)", symbol: "laptopcomputer")
                        MetricCard(title: "CPUs", value: "\(host.cpus)", symbol: "cpu")
                        MetricCard(title: "Memory", value: ByteFormatting.megabytes(host.totalMemoryMB), symbol: "memorychip")
                        MetricCard(title: "Containers", value: "\(host.containersRunning) running / \(host.containers)", symbol: "square.stack.3d.up")
                        MetricCard(title: "Images", value: "\(host.images)", symbol: "square.2.layers.3d")
                    }
                } else {
                    ContentUnavailableView(
                        "No System Data",
                        systemImage: "cpu",
                        description: Text("Load Docker host information on demand.")
                    )
                }
                if let stats {
                    HStack {
                        Text("Current usage").font(.headline)
                        Text("LIVE SNAPSHOT").font(.caption2.weight(.bold)).foregroundStyle(.secondary)
                    }
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 170), spacing: 12)], spacing: 12) {
                        MetricCard(title: "CPU", value: String(format: "%.1f%%", stats.cpuPercent), symbol: "gauge.with.dots.needle.67percent")
                        MetricCard(title: "Memory", value: "\(ByteFormatting.megabytes(stats.memoryUsageMB)) / \(ByteFormatting.megabytes(stats.memoryLimitMB))", symbol: "memorychip")
                        MetricCard(title: "Memory %", value: String(format: "%.1f%%", stats.memoryPercent), symbol: "chart.bar.fill")
                        MetricCard(title: "Containers", value: "\(stats.containersRunning) / \(stats.containersTotal)", symbol: "square.stack.3d.up.fill")
                    }
                }
                if let errorMessage {
                    Label(errorMessage, systemImage: "exclamationmark.triangle")
                        .foregroundStyle(.red)
                }
            }
            .padding(22)
        }
        .task {
            while !Task.isCancelled {
                await refresh()
                do {
                    try await Task.sleep(for: .seconds(30))
                } catch {
                    return
                }
            }
        }
    }

    private func refresh() async {
        loading = true
        defer { loading = false }
        do {
            let api = try session.api()
            async let hostResult = api.systemInfo()
            async let statsResult = api.hostStats()
            host = try await hostResult
            stats = try await statsResult
            errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

private struct MetricCard: View {
    let title: String
    let value: String
    let symbol: String

    var body: some View {
        CommandCenterSurface(tint: CommandCenterPalette.indigo) {
            VStack(alignment: .leading, spacing: 8) {
                Image(systemName: symbol)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(CommandCenterPalette.indigo)
                Text(title.uppercased()).font(.caption2.weight(.bold)).foregroundStyle(.secondary)
                Text(value).font(.headline).lineLimit(2)
            }
            .frame(maxWidth: .infinity, minHeight: 82, alignment: .leading)
            .padding(14)
        }
    }
}

struct ControllerSettingsView: View {
    @EnvironmentObject private var store: ConsoleStore
    @ObservedObject var session: ConnectionSession
    @State private var showEditor = false
    @State private var controllerPollSeconds = 300
    @State private var pollLoading = false
    @State private var pollMessage: String?

    var body: some View {
        Form {
            Section("Connection") {
                LabeledContent("Name", value: session.profile.name)
                LabeledContent("Base URL", value: session.profile.baseURL)
                LabeledContent("Transport", value: session.profile.isInsecureHTTP ? "HTTP — trusted network only" : "HTTPS")
                LabeledContent("Live events", value: session.eventStreamConnected ? "Connected" : "Not connected")
                Button("Edit Connection…") { showEditor = true }
            }
            Section("Refresh") {
                Picker("Mode", selection: Binding(
                    get: { session.profile.refreshMode },
                    set: { store.setRefreshMode($0, for: session.profile) }
                )) {
                    ForEach(RefreshMode.allCases) { mode in
                        Text(mode.title).tag(mode)
                    }
                }
                Text("Live uses controller events plus a 30-second safety refresh. Hidden windows pause background refreshes.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Section("Controller reconciliation") {
                Picker("Global interval", selection: $controllerPollSeconds) {
                    Text("Per-application default").tag(0)
                    Text("30 seconds").tag(30)
                    Text("1 minute").tag(60)
                    Text("3 minutes").tag(180)
                    Text("5 minutes").tag(300)
                    Text("10 minutes").tag(600)
                }
                HStack {
                    Button("Apply") { Task { await saveControllerPollInterval() } }
                        .disabled(pollLoading)
                    Button("Reload") { Task { await loadControllerPollInterval() } }
                        .disabled(pollLoading)
                }
                Text("This changes the controller’s global reconciliation interval. Per-application default clears the global override. It is separate from the client refresh mode above.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                if let pollMessage {
                    Text(pollMessage).font(.caption).foregroundStyle(.secondary)
                }
            }
            Section("Future security") {
                Text("Tokens are presently stored only with the local connection profile to support development. The security phase moves them to Keychain and adds HTTPS trust and client-certificate controls.")
                    .font(.caption)
            }
        }
        .formStyle(.grouped)
        .sheet(isPresented: $showEditor) {
            ConnectionEditor(profile: session.profile) { profile in
                store.save(profile: profile)
                showEditor = false
            }
        }
        .task { await loadControllerPollInterval() }
    }

    private func loadControllerPollInterval() async {
        pollLoading = true
        defer { pollLoading = false }
        do {
            let response = try await session.api().pollInterval()
            controllerPollSeconds = Int(response.intervalMs / 1_000)
            pollMessage = response.intervalMs == 0 ? "Using per-application defaults." : "Controller interval loaded."
        } catch {
            pollMessage = error.localizedDescription
        }
    }

    private func saveControllerPollInterval() async {
        pollLoading = true
        defer { pollLoading = false }
        do {
            let response = try await session.api().setPollInterval(milliseconds: Int64(controllerPollSeconds) * 1_000)
            controllerPollSeconds = Int(response.intervalMs / 1_000)
            pollMessage = "Controller interval updated."
        } catch {
            pollMessage = error.localizedDescription
        }
    }
}

private enum ByteFormatting {
    static func megabytes(_ value: Int64) -> String { "\(value.formatted()) MB" }
    static func megabytes(_ value: Double) -> String { String(format: "%.0f MB", value) }
}
