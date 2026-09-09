import SwiftUI

struct DashboardView: View {
    @ObservedObject var session: ConnectionSession

    private var managedApplications: [ApplicationSummary] {
        session.applications.filter { !isIntentionallyEmpty($0) }
    }

    private var intentionallyEmpty: [ApplicationSummary] {
        session.applications.filter(isIntentionallyEmpty)
    }

    private var healthyCount: Int {
        managedApplications.filter { $0.status.healthStatus.caseInsensitiveCompare("Healthy") == .orderedSame }.count
    }

    private var currentRevision: String? {
        let revisions = session.applications.compactMap(\.status.headSHA)
        return revisions.max(by: { lhs, rhs in
            revisions.filter { $0 == lhs }.count < revisions.filter { $0 == rhs }.count
        })
    }

    private var recentActivity: [SyncRecord] {
        session.applications.flatMap { $0.recentHistory ?? [] }
            .sorted { $0.startedAt > $1.startedAt }
            .prefix(12).map { $0 }
    }

    private var attentionItems: [AttentionItem] {
        let degraded = managedApplications.filter {
            $0.status.healthStatus.caseInsensitiveCompare("Healthy") != .orderedSame ||
            $0.status.syncStatus.caseInsensitiveCompare("Synced") != .orderedSame
        }.map {
            AttentionItem(
                id: $0.id,
                title: $0.metadata.name,
                detail: "\($0.status.healthStatus) · \($0.status.syncStatus)",
                tone: $0.status.healthStatus.caseInsensitiveCompare("Degraded") == .orderedSame ? CommandCenterPalette.coral : CommandCenterPalette.amber
            )
        }
        return degraded
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                commandHeader
                hero
                HStack(alignment: .top, spacing: 16) {
                    attentionQueue
                    deploymentPulse
                }
                fleetRoster
            }
            .padding(24)
            .background {
                LinearGradient(
                    colors: [CommandCenterPalette.indigo.opacity(0.12), .clear, CommandCenterPalette.mint.opacity(0.05)],
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                )
                .ignoresSafeArea()
            }
        }
    }

    private var commandHeader: some View {
        HStack(alignment: .firstTextBaseline) {
            VStack(alignment: .leading, spacing: 5) {
                Label("FLEET COMMAND CENTER", systemImage: "dot.radiowaves.left.and.right")
                    .font(.caption.weight(.bold))
                    .foregroundStyle(CommandCenterPalette.indigo)
                Text(session.profile.name)
                    .font(.system(size: 29, weight: .bold, design: .rounded))
                Text("A live view of deployments, service health, and the next useful action.")
                    .font(.callout)
                    .foregroundStyle(.secondary)
            }
            Spacer()
            VStack(alignment: .trailing, spacing: 6) {
                CommandStatusChip(title: session.state.title)
                if let lastRefresh = session.lastRefresh {
                    Text("Fresh \(lastRefresh, style: .relative)")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
        }
    }

    private var hero: some View {
        CommandCenterSurface(tint: CommandCenterPalette.mint) {
            HStack(spacing: 24) {
                HealthHalo(healthy: healthyCount, total: managedApplications.count, label: "healthy")
                VStack(alignment: .leading, spacing: 10) {
                    Text(healthyCount == managedApplications.count ? "All managed services are nominal" : "Fleet attention required")
                        .font(.title2.bold())
                    Text(healthyCount == managedApplications.count
                         ? "Every application with declared services is running at the current manifest revision."
                         : "Review the attention queue before making another deployment.")
                        .foregroundStyle(.secondary)
                    HStack(spacing: 8) {
                        CommandStatusChip(title: "\(session.applications.count) applications")
                        CommandStatusChip(title: "\(managedApplications.count) managed")
                        RevisionTag(revision: currentRevision)
                    }
                }
                Spacer(minLength: 0)
                VStack(alignment: .trailing, spacing: 5) {
                    Text("REFRESH MODE").font(.caption2.weight(.bold)).foregroundStyle(.secondary)
                    Text(session.profile.refreshMode.title).font(.headline)
                }
            }
            .padding(22)
        }
    }

    private var attentionQueue: some View {
        CommandCenterSurface(tint: attentionItems.isEmpty ? CommandCenterPalette.mint : CommandCenterPalette.amber) {
            VStack(alignment: .leading, spacing: 12) {
                Label(attentionItems.isEmpty ? "No attention required" : "Attention queue", systemImage: attentionItems.isEmpty ? "checkmark.seal.fill" : "sparkle.magnifyingglass")
                    .font(.headline)
                    .foregroundStyle(attentionItems.isEmpty ? CommandCenterPalette.mint : .primary)
                if attentionItems.isEmpty {
                    Text("Every managed application is healthy and reconciled. Empty manifests remain visible in the roster as context, not an alert.")
                        .font(.callout)
                        .foregroundStyle(.secondary)
                        .frame(maxWidth: .infinity, alignment: .leading)
                } else {
                    ForEach(attentionItems) { item in
                        HStack(spacing: 10) {
                            Circle().fill(item.tone).frame(width: 8, height: 8)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(item.title).fontWeight(.semibold)
                                Text(item.detail).font(.caption).foregroundStyle(.secondary)
                            }
                            Spacer()
                        }
                        .padding(.vertical, 4)
                    }
                }
            }
            .padding(18)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .frame(maxWidth: .infinity)
    }

    private var deploymentPulse: some View {
        CommandCenterSurface(tint: CommandCenterPalette.indigo) {
            VStack(alignment: .leading, spacing: 12) {
                HStack {
                    Label("Deployment pulse", systemImage: "waveform.path.ecg")
                        .font(.headline)
                    Spacer()
                    Text("\(recentActivity.count) recent")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                PulseRail(records: recentActivity)
                if let latest = recentActivity.first {
                    HStack {
                        Text(latest.appName).font(.caption.weight(.semibold))
                        Text("\(latest.operation.capitalized) · \(latest.result.capitalized)")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        Spacer()
                        Text(latest.startedAt, style: .relative)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                } else {
                    Text("No recent operations yet.").font(.caption).foregroundStyle(.secondary)
                }
            }
            .padding(18)
        }
        .frame(maxWidth: .infinity)
    }

    private var fleetRoster: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text("Fleet roster").font(.title3.bold())
                Text("STATUS · REVISION · SERVICES").font(.caption2.weight(.bold)).foregroundStyle(.secondary)
                Spacer()
                Text("Select Applications for deployment controls").font(.caption).foregroundStyle(.secondary)
            }
            ForEach(session.applications) { app in
                FleetRosterRow(app: app, intentionallyEmpty: isIntentionallyEmpty(app))
            }
        }
    }

    private func isIntentionallyEmpty(_ app: ApplicationSummary) -> Bool {
        (app.status.services ?? []).isEmpty && app.status.healthStatus.caseInsensitiveCompare("Unknown") == .orderedSame
    }
}

private struct AttentionItem: Identifiable {
    let id: String
    let title: String
    let detail: String
    let tone: Color
}

private struct PulseRail: View {
    let records: [SyncRecord]

    var body: some View {
        HStack(spacing: 5) {
            ForEach(Array(records.prefix(12).enumerated()), id: \.element.id) { _, record in
                Capsule()
                    .fill(color(for: record.result))
                    .frame(maxWidth: .infinity, minHeight: 8, maxHeight: 30)
                    .opacity(record.result.caseInsensitiveCompare("success") == .orderedSame ? 0.9 : 1)
                    .accessibilityLabel("\(record.appName): \(record.result)")
            }
            if records.isEmpty {
                Capsule().fill(.primary.opacity(0.1)).frame(height: 8)
            }
        }
        .frame(height: 30)
    }

    private func color(for result: String) -> Color {
        switch result.lowercased() {
        case "success": CommandCenterPalette.mint
        case "failure": CommandCenterPalette.coral
        default: CommandCenterPalette.amber
        }
    }
}

private struct FleetRosterRow: View {
    let app: ApplicationSummary
    let intentionallyEmpty: Bool

    var body: some View {
        CommandCenterSurface(tint: tint) {
            HStack(spacing: 14) {
                Circle().fill(tint).frame(width: 10, height: 10).shadow(color: tint.opacity(0.5), radius: 5)
                VStack(alignment: .leading, spacing: 4) {
                    Text(app.metadata.name).font(.headline)
                    HStack(spacing: 7) {
                        RevisionTag(revision: app.status.headSHA)
                        Text(serviceLabel).font(.caption).foregroundStyle(.secondary)
                    }
                }
                Spacer()
                if intentionallyEmpty {
                    Text("Intentionally empty").font(.caption.weight(.medium)).foregroundStyle(.secondary)
                } else {
                    CommandStatusChip(title: app.status.syncStatus)
                    CommandStatusChip(title: app.status.healthStatus)
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 13)
        }
    }

    private var serviceLabel: String {
        let count = app.status.services?.count ?? 0
        return count == 1 ? "1 service" : "\(count) services"
    }

    private var tint: Color {
        if intentionallyEmpty { return CommandCenterPalette.indigo }
        if app.status.healthStatus.caseInsensitiveCompare("Healthy") == .orderedSame { return CommandCenterPalette.mint }
        if app.status.healthStatus.caseInsensitiveCompare("Degraded") == .orderedSame { return CommandCenterPalette.coral }
        return CommandCenterPalette.amber
    }
}
