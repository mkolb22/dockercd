import SwiftUI

struct ApplicationsWorkspace: View {
    @ObservedObject var session: ConnectionSession
    @State private var selectedAppID: String?
    @State private var showCreateApplication = false
    @State private var searchText = ""

    private var filteredApplications: [ApplicationSummary] {
        let query = searchText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !query.isEmpty else { return session.applications }
        return session.applications.filter {
            $0.metadata.name.localizedCaseInsensitiveContains(query) ||
            $0.status.healthStatus.localizedCaseInsensitiveContains(query) ||
            $0.status.syncStatus.localizedCaseInsensitiveContains(query)
        }
    }

    var body: some View {
        NavigationSplitView {
            List(selection: $selectedAppID) {
                Section("Applications") {
                    ForEach(filteredApplications) { app in
                        ApplicationRow(app: app)
                            .tag(app.id)
                    }
                }
            }
            .searchable(text: $searchText, prompt: "Search applications")
            .overlay {
                if session.applications.isEmpty && !session.refreshInProgress {
                    ContentUnavailableView(
                        "No Applications",
                        systemImage: "square.grid.2x2",
                        description: Text("Refresh the controller or add an application.")
                    )
                }
            }
            .toolbar {
                ToolbarItem {
                    Button {
                        showCreateApplication = true
                    } label: {
                        Label("Add Application", systemImage: "plus")
                    }
                }
            }
        } detail: {
            if let selectedAppID, let app = session.application(named: selectedAppID) {
                ApplicationDetailView(session: session, app: app)
            } else {
                ContentUnavailableView("Select an Application", systemImage: "app.dashed")
            }
        }
        .sheet(isPresented: $showCreateApplication) {
            ApplicationEditor(session: session)
        }
        .onChange(of: session.applications.map(\.id)) { _, ids in
            if selectedAppID == nil || !ids.contains(selectedAppID ?? "") {
                selectedAppID = ids.first
            }
        }
    }
}

private struct ApplicationRow: View {
    let app: ApplicationSummary

    var body: some View {
        HStack(spacing: 10) {
            Circle()
                .fill(healthTone)
                .frame(width: 8, height: 8)
                .shadow(color: healthTone.opacity(0.55), radius: 4)
            VStack(alignment: .leading, spacing: 5) {
                Text(app.metadata.name)
                    .font(.system(.body, design: .rounded).weight(.semibold))
                    .lineLimit(1)
                HStack(spacing: 6) {
                    RevisionTag(revision: app.status.headSHA)
                    Text("\(app.status.services?.count ?? 0) service\((app.status.services?.count ?? 0) == 1 ? "" : "s")")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
            }
            Spacer(minLength: 4)
            CommandStatusChip(title: app.status.healthStatus)
        }
        .padding(.vertical, 7)
        .contentShape(Rectangle())
    }

    private var healthTone: Color {
        switch app.status.healthStatus.lowercased() {
        case "healthy": CommandCenterPalette.mint
        case "degraded", "error": CommandCenterPalette.coral
        default: CommandCenterPalette.amber
        }
    }
}

struct ApplicationDetailView: View {
    @ObservedObject var session: ConnectionSession
    let app: ApplicationSummary
    @State private var history: [SyncRecord] = []
    @State private var events: [EventRecord] = []
    @State private var diff: DiffResult?
    @State private var desired: RenderedDesiredResponse?
    @State private var selectedService: String?
    @State private var logs: [String] = []
    @State private var serviceDetail: ServiceDetail?
    @State private var isLoading = false
    @State private var operationDescription: String?
    @State private var errorMessage: String?
    @State private var showSyncConfirmation = false
    @State private var showDeleteConfirmation = false
    @State private var showEditApplication = false
    @State private var rollbackRecord: SyncRecord?

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            applicationHeader
            TabView {
                overviewTab.tabItem { Label("Overview", systemImage: "rectangle.3.group") }
                desiredTab.tabItem { Label("Desired", systemImage: "doc.text") }
                diffTab.tabItem { Label("Diff", systemImage: "arrow.left.arrow.right") }
                historyTab.tabItem { Label("History", systemImage: "clock.arrow.circlepath") }
                eventsTab.tabItem { Label("Events", systemImage: "bell") }
                metricsTab.tabItem { Label("Metrics", systemImage: "chart.xyaxis.line") }
                logsTab.tabItem { Label("Logs", systemImage: "text.alignleft") }
            }
            .padding(.horizontal, 18)
        }
        .task(id: app.id) {
            await loadHistoryAndEvents()
        }
        .sheet(isPresented: $showEditApplication) {
            ApplicationEditor(session: session, existing: app)
        }
        .confirmationDialog("Sync \(app.metadata.name)?", isPresented: $showSyncConfirmation, titleVisibility: .visible) {
            Button("Sync Now") { Task { await sync() } }
        } message: {
            Text("This asks \(session.profile.name) to reconcile this application.")
        }
        .confirmationDialog("Delete \(app.metadata.name)?", isPresented: $showDeleteConfirmation, titleVisibility: .visible) {
            Button("Delete Application", role: .destructive) { Task { await deleteApplication() } }
        } message: {
            Text("This removes the application record from \(session.profile.name). It does not automatically delete running containers.")
        }
        .confirmationDialog("Rollback \(app.metadata.name)?", isPresented: Binding(
            get: { rollbackRecord != nil },
            set: { if !$0 { rollbackRecord = nil } }
        ), titleVisibility: .visible) {
            Button("Rollback") {
                if let rollbackRecord { Task { await rollback(to: rollbackRecord) } }
            }
        } message: {
            Text("Reconcile this application at \(rollbackRecord?.commitSHA ?? "the selected revision").")
        }
        .alert("Action failed", isPresented: Binding(
            get: { errorMessage != nil },
            set: { if !$0 { errorMessage = nil } }
        )) {
            Button("OK", role: .cancel) { errorMessage = nil }
        } message: {
            Text(errorMessage ?? "")
        }
    }

    private var applicationHeader: some View {
        CommandCenterSurface(tint: applicationTone) {
            HStack(alignment: .center, spacing: 18) {
                HealthHalo(
                    healthy: app.status.healthStatus.caseInsensitiveCompare("Healthy") == .orderedSame ? 1 : 0,
                    total: 1,
                    label: app.status.healthStatus
                )
                .scaleEffect(0.72)
                .frame(width: 80, height: 80)
                VStack(alignment: .leading, spacing: 8) {
                    Text("APPLICATION DEPLOYMENT")
                        .font(.caption2.weight(.bold))
                        .foregroundStyle(applicationTone)
                    HStack(spacing: 8) {
                        Text(app.metadata.name).font(.title2.bold())
                        CommandStatusChip(title: app.status.healthStatus)
                        CommandStatusChip(title: app.status.syncStatus)
                    }
                    HStack(spacing: 7) {
                        RevisionTag(revision: app.status.headSHA)
                        Text(app.spec.destination.projectName)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    Text(app.spec.source.repoURL)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                    if let error = app.status.lastError, !error.isEmpty {
                        Label(error, systemImage: "exclamationmark.triangle.fill")
                            .font(.caption)
                            .foregroundStyle(CommandCenterPalette.coral)
                            .lineLimit(2)
                    }
                }
                Spacer(minLength: 8)
                VStack(alignment: .trailing, spacing: 9) {
                    if let operationDescription {
                        ProgressView(operationDescription)
                            .controlSize(.small)
                    }
                    Button("Sync now") { showSyncConfirmation = true }
                        .buttonStyle(.borderedProminent)
                        .tint(CommandCenterPalette.indigo)
                        .disabled(operationDescription != nil)
                    HStack(spacing: 3) {
                        Button("Edit") { showEditApplication = true }
                        Button(role: .destructive) { showDeleteConfirmation = true } label: {
                            Image(systemName: "trash")
                        }
                    }
                    .controlSize(.small)
                    .disabled(operationDescription != nil)
                }
            }
        }
        .padding(20)
    }

    private var overviewTab: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                CommandCenterSurface(tint: CommandCenterPalette.indigo) {
                    Grid(alignment: .leading, horizontalSpacing: 30, verticalSpacing: 9) {
                        GridRow { Text("Project").foregroundStyle(.secondary); Text(app.spec.destination.projectName) }
                        GridRow { Text("Target revision").foregroundStyle(.secondary); Text(app.spec.source.targetRevision).monospaced() }
                        GridRow { Text("Manifest path").foregroundStyle(.secondary); Text(app.spec.source.path).monospaced() }
                        GridRow { Text("Last reconciliation").foregroundStyle(.secondary); Text(app.status.lastSyncTime ?? "Never") }
                    }
                    .padding(16)
                }
                HStack {
                    Text("Services").font(.headline)
                    Text("LIVE RUNTIME").font(.caption2.weight(.bold)).foregroundStyle(.secondary)
                }
                ForEach(app.status.services ?? []) { service in
                    CommandCenterSurface(tint: serviceTone(service)) {
                        HStack(spacing: 13) {
                            Circle().fill(serviceTone(service)).frame(width: 8, height: 8)
                            VStack(alignment: .leading, spacing: 4) {
                                Text(service.name).fontWeight(.semibold)
                                Text(service.image).font(.caption.monospaced()).foregroundStyle(.secondary).lineLimit(1)
                            }
                            Spacer()
                            Text(service.state).font(.caption).foregroundStyle(.secondary)
                            CommandStatusChip(title: service.health)
                        }
                        .padding(.horizontal, 15)
                        .padding(.vertical, 12)
                    }
                }
                if (app.status.services ?? []).isEmpty {
                    Text("No service detail has been reported yet.")
                        .foregroundStyle(.secondary)
                }
            }
            .padding(.vertical, 18)
        }
    }

    private var applicationTone: Color {
        switch app.status.healthStatus.lowercased() {
        case "healthy": CommandCenterPalette.mint
        case "degraded", "error": CommandCenterPalette.coral
        default: CommandCenterPalette.amber
        }
    }

    private func serviceTone(_ service: ServiceStatus) -> Color {
        switch service.health.lowercased() {
        case "healthy", "running": CommandCenterPalette.mint
        case "degraded", "error", "failed": CommandCenterPalette.coral
        default: CommandCenterPalette.amber
        }
    }

    private var diffTab: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                HStack {
                    Text(diff?.inSync == true ? "In sync" : "Current diff")
                        .font(.headline)
                    Spacer()
                    Button("Refresh Diff") { Task { await loadDiff() } }
                }
                if let diff {
                    Text(diff.summary).foregroundStyle(.secondary)
                    ForEach(combinedChanges(diff)) { change in
                        VStack(alignment: .leading, spacing: 6) {
                            Text("\(change.changeType.capitalized): \(change.serviceName)").fontWeight(.medium)
                            ForEach(change.fields ?? [], id: \.field) { field in
                                Text("\(field.field): \(field.desired) → \(field.live)")
                                    .font(.caption.monospaced())
                                    .textSelection(.enabled)
                            }
                        }
                        .padding(12)
                        .background(.quaternary, in: RoundedRectangle(cornerRadius: 10))
                    }
                } else {
                    ContentUnavailableView(
                        "No Diff Loaded",
                        systemImage: "arrow.left.arrow.right",
                        description: Text("Compute the current desired-versus-live state on demand.")
                    )
                }
            }
            .padding(.vertical, 18)
        }
    }

    private var desiredTab: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                HStack {
                    Text("Rendered Desired State").font(.headline)
                    Spacer()
                    Button("Load Desired State") { Task { await loadDesired() } }
                }
                if let desired {
                    Text("Revision \(desired.headSHA.prefix(12))")
                        .font(.caption.monospaced())
                        .foregroundStyle(.secondary)
                    if let compose = desired.compose {
                        ForEach(compose.services) { service in
                            VStack(alignment: .leading, spacing: 5) {
                                Text(service.name).fontWeight(.medium)
                                Text(service.image).font(.caption.monospaced())
                                if let command = service.command, !command.isEmpty {
                                    Text(command.joined(separator: " "))
                                        .font(.caption.monospaced())
                                        .foregroundStyle(.secondary)
                                }
                                if let environment = service.environment, !environment.isEmpty {
                                    Text("\(environment.count) environment value(s) redacted by controller")
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                }
                            }
                            .padding(12)
                            .background(.quaternary, in: RoundedRectangle(cornerRadius: 10))
                        }
                    } else {
                        Text("The controller returned no rendered compose state.")
                            .foregroundStyle(.secondary)
                    }
                } else {
                    ContentUnavailableView(
                        "No Desired State Loaded",
                        systemImage: "doc.text",
                        description: Text("Fetch the current desired compose state only when this tab is needed.")
                    )
                }
            }
            .padding(.vertical, 18)
        }
    }

    private var historyTab: some View {
        List(history) { record in
            HStack {
                VStack(alignment: .leading, spacing: 3) {
                    Text("\(record.operation.capitalized) · \(record.result.capitalized)")
                    Text(record.startedAt, style: .relative)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    if let error = record.error, !error.isEmpty {
                        Text(error).font(.caption).foregroundStyle(.red).lineLimit(2)
                    }
                }
                Spacer()
                if let sha = record.commitSHA, !sha.isEmpty {
                    Text(sha.prefix(8)).font(.caption.monospaced())
                    Button("Rollback") { rollbackRecord = record }
                        .buttonStyle(.bordered)
                }
            }
        }
    }

    private var eventsTab: some View {
        List(events) { event in
            VStack(alignment: .leading, spacing: 3) {
                Text(event.type).fontWeight(.medium)
                Text(event.message)
                Text(event.createdAt, style: .relative)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
    }

    private var logsTab: some View {
        VStack(alignment: .leading, spacing: 12) {
            Picker("Service", selection: $selectedService) {
                Text("Choose a service").tag(Optional<String>.none)
                ForEach(app.status.services ?? []) { service in
                    Text(service.name).tag(Optional(service.name))
                }
            }
            .frame(maxWidth: 320)
            HStack {
                Button("Load Logs") { Task { await loadLogs() } }
                    .disabled(selectedService == nil)
                Spacer()
            }
            ScrollView {
                Text(logs.joined(separator: "\n"))
                    .font(.caption.monospaced())
                    .textSelection(.enabled)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(12)
            }
            .background(.black.opacity(0.12), in: RoundedRectangle(cornerRadius: 8))
        }
        .padding(.vertical, 18)
    }

    private var metricsTab: some View {
        VStack(alignment: .leading, spacing: 12) {
            Picker("Service", selection: $selectedService) {
                Text("Choose a service").tag(Optional<String>.none)
                ForEach(app.status.services ?? []) { service in
                    Text(service.name).tag(Optional(service.name))
                }
            }
            .frame(maxWidth: 320)
            HStack {
                Button("Load Service Metrics") { Task { await loadServiceDetail() } }
                    .disabled(selectedService == nil)
                Spacer()
            }
            if let detail = serviceDetail {
                ScrollView {
                    VStack(alignment: .leading, spacing: 14) {
                        Grid(alignment: .leading, horizontalSpacing: 28, verticalSpacing: 8) {
                            GridRow { Text("Container").foregroundStyle(.secondary); Text(detail.containerName ?? detail.containerId).textSelection(.enabled) }
                            GridRow { Text("Image").foregroundStyle(.secondary); Text(detail.image).textSelection(.enabled) }
                            GridRow { Text("State").foregroundStyle(.secondary); Text(detail.status ?? "Unknown") }
                            GridRow { Text("Health").foregroundStyle(.secondary); StatusPill(title: detail.health) }
                        }
                        if let metrics = detail.metrics {
                            LazyVGrid(columns: [GridItem(.adaptive(minimum: 150), spacing: 12)], spacing: 12) {
                                ServiceMetricCard(title: "CPU", value: String(format: "%.1f%%", metrics.cpuPercent))
                                ServiceMetricCard(title: "Memory", value: String(format: "%.0f MB (%.1f%%)", metrics.memoryUsageMB, metrics.memoryPercent))
                                ServiceMetricCard(title: "Network RX", value: String(format: "%.1f MB", metrics.networkRxMB))
                                ServiceMetricCard(title: "Network TX", value: String(format: "%.1f MB", metrics.networkTxMB))
                                ServiceMetricCard(title: "PIDs", value: "\(metrics.pids)")
                                ServiceMetricCard(title: "Uptime", value: metrics.uptime)
                            }
                        } else {
                            Text("The controller did not report runtime metrics for this service.")
                                .foregroundStyle(.secondary)
                        }
                    }
                    .padding(.vertical, 10)
                }
            } else {
                ContentUnavailableView(
                    "No Metrics Loaded",
                    systemImage: "chart.xyaxis.line",
                    description: Text("Service inspection is performed only when requested.")
                )
            }
        }
        .padding(.vertical, 18)
    }

    private func loadHistoryAndEvents() async {
        do {
            let api = try session.api()
            async let historyResult = api.history(for: app.id)
            async let eventResult = api.events(for: app.id)
            history = try await historyResult
            events = try await eventResult
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func combinedChanges(_ diff: DiffResult) -> [ServiceDiff] {
        (diff.toCreate ?? []) + (diff.toUpdate ?? []) + (diff.toRemove ?? [])
    }

    private func loadDiff() async {
        isLoading = true
        defer { isLoading = false }
        do { diff = try await session.api().applicationDiff(app.id) }
        catch { errorMessage = error.localizedDescription }
    }

    private func loadDesired() async {
        isLoading = true
        defer { isLoading = false }
        do { desired = try await session.api().renderedDesired(app.id) }
        catch { errorMessage = error.localizedDescription }
    }

    private func loadLogs() async {
        guard let selectedService else { return }
        do { logs = try await session.api().serviceLogs(app: app.id, service: selectedService, tail: 500) }
        catch { errorMessage = error.localizedDescription }
    }

    private func loadServiceDetail() async {
        guard let selectedService else { return }
        do { serviceDetail = try await session.api().serviceDetail(app: app.id, service: selectedService) }
        catch { errorMessage = error.localizedDescription }
    }

    private func sync() async {
        operationDescription = "Syncing…"
        defer { operationDescription = nil }
        do {
            try await session.api().syncApplication(app.id)
            await session.refresh()
            await loadHistoryAndEvents()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func rollback(to record: SyncRecord) async {
        guard let sha = record.commitSHA else { return }
        operationDescription = "Rolling back…"
        defer { operationDescription = nil }
        do {
            try await session.api().rollbackApplication(app.id, sha: sha)
            await session.refresh()
            await loadHistoryAndEvents()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func deleteApplication() async {
        operationDescription = "Deleting…"
        defer { operationDescription = nil }
        do {
            try await session.api().deleteApplication(app.id)
            await session.refresh()
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

struct StatusPill: View {
    let title: String

    var body: some View {
        CommandStatusChip(title: title)
    }
}

private struct ServiceMetricCard: View {
    let title: String
    let value: String

    var body: some View {
        CommandCenterSurface(tint: CommandCenterPalette.indigo) {
            VStack(alignment: .leading, spacing: 6) {
                Text(title.uppercased()).font(.caption2.weight(.bold)).foregroundStyle(.secondary)
                Text(value).font(.headline).lineLimit(2)
            }
            .frame(maxWidth: .infinity, minHeight: 64, alignment: .leading)
            .padding(12)
        }
    }
}

struct ApplicationEditor: View {
    @Environment(\.dismiss) private var dismiss
    @ObservedObject var session: ConnectionSession
    let existing: ApplicationSummary?
    @State private var name = ""
    @State private var repoURL = ""
    @State private var revision = "main"
    @State private var path = "."
    @State private var composeFile = "docker-compose.yml"
    @State private var projectName = ""
    @State private var automated = true
    @State private var prune = true
    @State private var selfHeal = true
    @State private var errorMessage: String?
    @State private var saving = false

    init(session: ConnectionSession, existing: ApplicationSummary? = nil) {
        self.session = session
        self.existing = existing
        _name = State(initialValue: existing?.metadata.name ?? "")
        _repoURL = State(initialValue: existing?.spec.source.repoURL ?? "")
        _revision = State(initialValue: existing?.spec.source.targetRevision ?? "main")
        _path = State(initialValue: existing?.spec.source.path ?? ".")
        _composeFile = State(initialValue: existing?.spec.source.composeFiles.first ?? "docker-compose.yml")
        _projectName = State(initialValue: existing?.spec.destination.projectName ?? "")
        _automated = State(initialValue: existing?.spec.syncPolicy.automated ?? true)
        _prune = State(initialValue: existing?.spec.syncPolicy.prune ?? true)
        _selfHeal = State(initialValue: existing?.spec.syncPolicy.selfHeal ?? true)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text(existing == nil ? "Add Application" : "Edit Application").font(.title2.bold())
            Form {
                TextField("Name", text: $name).disabled(existing != nil)
                TextField("Repository URL", text: $repoURL)
                TextField("Revision", text: $revision)
                TextField("Path", text: $path)
                TextField("Compose file", text: $composeFile)
                TextField("Compose project", text: $projectName)
                Toggle("Automated sync", isOn: $automated)
                Toggle("Prune", isOn: $prune)
                Toggle("Self-heal", isOn: $selfHeal)
            }
            if let errorMessage { Text(errorMessage).font(.caption).foregroundStyle(.red) }
            HStack {
                Spacer()
                Button("Cancel") { dismiss() }
                Button(existing == nil ? "Create" : "Save") { Task { await save() } }
                    .buttonStyle(.borderedProminent)
                    .disabled(saving || name.isEmpty || repoURL.isEmpty || projectName.isEmpty)
            }
        }
        .padding(24)
        .frame(width: 540)
    }

    private func save() async {
        saving = true
        defer { saving = false }
        let draft = ApplicationDraft(
            metadata: ApplicationMetadata(name: name),
            spec: ApplicationSpec(
                source: SourceSpec(repoURL: repoURL, targetRevision: revision, path: path, composeFiles: [composeFile]),
                destination: DestinationSpec(dockerHost: "unix:///var/run/docker.sock", projectName: projectName),
                syncPolicy: SyncPolicy(automated: automated, prune: prune, selfHeal: selfHeal, pollInterval: nil, syncTimeout: nil, healthTimeout: nil)
            )
        )
        do {
            if let existing {
                _ = try await session.api().updateApplication(existing.id, draft: draft)
            } else {
                _ = try await session.api().createApplication(draft)
            }
            await session.refresh()
            dismiss()
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}
