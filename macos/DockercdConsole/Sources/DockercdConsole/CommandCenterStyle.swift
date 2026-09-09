import SwiftUI

enum CommandCenterPalette {
    static let mint = Color(red: 0.16, green: 0.82, blue: 0.57)
    static let amber = Color(red: 0.96, green: 0.65, blue: 0.20)
    static let coral = Color(red: 0.96, green: 0.34, blue: 0.38)
    static let indigo = Color(red: 0.42, green: 0.47, blue: 0.96)
    static let ink = Color(red: 0.06, green: 0.08, blue: 0.12)
    static let slate = Color(red: 0.12, green: 0.16, blue: 0.23)
}

struct CommandCenterSurface<Content: View>: View {
    let tint: Color
    let content: Content

    init(tint: Color = CommandCenterPalette.indigo, @ViewBuilder content: () -> Content) {
        self.tint = tint
        self.content = content()
    }

    var body: some View {
        content
            .background {
                RoundedRectangle(cornerRadius: 20, style: .continuous)
                    .fill(.regularMaterial)
                    .overlay {
                        RoundedRectangle(cornerRadius: 20, style: .continuous)
                            .fill(
                                LinearGradient(
                                    colors: [tint.opacity(0.16), .clear, .clear],
                                    startPoint: .topLeading,
                                    endPoint: .bottomTrailing
                                )
                            )
                    }
                    .overlay {
                        RoundedRectangle(cornerRadius: 20, style: .continuous)
                            .strokeBorder(.white.opacity(0.13), lineWidth: 1)
                    }
            }
    }
}

struct HealthHalo: View {
    let healthy: Int
    let total: Int
    let label: String

    private var progress: CGFloat {
        guard total > 0 else { return 0 }
        return CGFloat(healthy) / CGFloat(total)
    }

    var body: some View {
        ZStack {
            Circle()
                .stroke(.primary.opacity(0.10), style: StrokeStyle(lineWidth: 11))
            Circle()
                .trim(from: 0, to: progress)
                .stroke(
                    AngularGradient(
                        colors: [CommandCenterPalette.mint.opacity(0.55), CommandCenterPalette.mint, CommandCenterPalette.indigo],
                        center: .center
                    ),
                    style: StrokeStyle(lineWidth: 11, lineCap: .round)
                )
                .rotationEffect(.degrees(-90))
                .animation(.spring(duration: 0.55), value: progress)
            VStack(spacing: 2) {
                Text("\(healthy)")
                    .font(.system(size: 31, weight: .bold, design: .rounded))
                Text(label.uppercased())
                    .font(.caption2.weight(.bold))
                    .foregroundStyle(.secondary)
            }
        }
        .frame(width: 108, height: 108)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(healthy) of \(total) \(label)")
    }
}

struct CommandStatusChip: View {
    let title: String

    private var tone: Color {
        switch title.lowercased() {
        case "healthy", "synced", "success", "connected", "running": CommandCenterPalette.mint
        case "degraded", "error", "failure": CommandCenterPalette.coral
        case "progressing", "outofsync", "awaitingsync", "unknown": CommandCenterPalette.amber
        default: CommandCenterPalette.indigo
        }
    }

    var body: some View {
        HStack(spacing: 5) {
            Circle().fill(tone).frame(width: 6, height: 6)
            Text(title)
        }
        .font(.caption.weight(.semibold))
        .foregroundStyle(tone)
        .padding(.horizontal, 8)
        .padding(.vertical, 5)
        .background(tone.opacity(0.12), in: Capsule())
    }
}

struct RevisionTag: View {
    let revision: String?

    var body: some View {
        Text(revision.map { String($0.prefix(8)) } ?? "no revision")
            .font(.caption2.monospaced().weight(.medium))
            .foregroundStyle(.secondary)
            .padding(.horizontal, 7)
            .padding(.vertical, 4)
            .background(.primary.opacity(0.07), in: Capsule())
    }
}
