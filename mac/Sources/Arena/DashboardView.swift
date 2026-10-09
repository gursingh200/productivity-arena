import ArenaCore
import Charts
import SwiftUI

/// Colours shared with the web app: the person's background and series colours
/// (Settings → Appearance on the website), graphite and ember until it sends them.
enum Palette {
    nonisolated(unsafe) static var bg = Color(hex: 0x0f1012)
    nonisolated(unsafe) static var panel = Color(hex: 0x17181b)
    nonisolated(unsafe) static var raised = Color(hex: 0x1f2024)
    nonisolated(unsafe) static var line = Color(hex: 0x2a2b30)
    static let text = Color(hex: 0xf3f1ed)
    static let text2 = Color(hex: 0xb3b0aa)
    static let muted = Color(hex: 0x7d7b77)
    nonisolated(unsafe) static var human = Color(hex: 0xe4692c)
    nonisolated(unsafe) static var agents = Color(hex: 0x5285e6)
    nonisolated(unsafe) static var meetings = Color(hex: 0x35a586)
    nonisolated(unsafe) static var accent = Color(hex: 0xf08a4b)

    static let savedKey = "appearance"

    /// Uses the website's colours, and remembers them for the next launch. Main thread.
    static func apply(_ a: StatusAppearance) {
        let hex = { (s: String) in UInt32(s.dropFirst(), radix: 16).map(Color.init(hex:)) }
        guard let bg = hex(a.bg), let panel = hex(a.panel), let raised = hex(a.raised), let line = hex(a.line),
              let human = hex(a.human), let agents = hex(a.agent), let meetings = hex(a.meeting), let accent = hex(a.accent) else { return }
        (Palette.bg, Palette.panel, Palette.raised, Palette.line) = (bg, panel, raised, line)
        (Palette.human, Palette.agents, Palette.meetings, Palette.accent) = (human, agents, meetings, accent)
        if let data = try? JSONEncoder().encode(a) { UserDefaults.standard.set(data, forKey: savedKey) }
    }

    /// The colours remembered from the last sync, if any.
    static func restore() {
        guard let data = UserDefaults.standard.data(forKey: savedKey),
              let a = try? JSONDecoder().decode(StatusAppearance.self, from: data) else { return }
        apply(a)
    }

    static func color(_ series: ActivitySeries) -> Color {
        switch series {
        case .human: return human
        case .agents: return agents
        case .meetings: return meetings
        }
    }
}

extension Color {
    init(hex: UInt32) {
        self.init(red: Double((hex >> 16) & 0xff) / 255, green: Double((hex >> 8) & 0xff) / 255, blue: Double(hex & 0xff) / 255)
    }
}

extension ActivitySeries {
    var label: String {
        switch self {
        case .human: return "Human"
        case .agents: return "Agents"
        case .meetings: return "Meetings"
        }
    }
}

extension ActivityRange {
    var label: String {
        switch self {
        case .day: return "Day"
        case .week: return "Week"
        case .month: return "Month"
        }
    }
}

enum Time {
    /// "4h 12m", "41m", or "<1m" for a few seconds.
    static func duration(_ seconds: Int) -> String {
        if seconds > 0 && seconds < 60 { return "<1m" }
        let minutes = seconds / 60
        return minutes >= 60 ? "\(minutes / 60)h \(String(format: "%02d", minutes % 60))m" : "\(minutes)m"
    }

    /// Categorical key for hour `h` ("00"–"23"), so bars of each series sit side by side.
    static func hourKey(_ h: Int) -> String { String(format: "%02d", h) }

    static func hour(_ h: Int) -> String {
        h == 0 ? "12 AM" : h < 12 ? "\(h) AM" : h == 12 ? "12 PM" : "\(h - 12) PM"
    }

    /// Short axis label: "12a", "3p".
    static func shortHour(_ h: Int) -> String {
        let twelve = h % 12 == 0 ? 12 : h % 12
        return "\(twelve)\(h < 12 ? "a" : "p")"
    }
}

struct DashboardView: View {
    @ObservedObject var model: DashboardModel

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 28) {
                header
                if let report = model.report {
                    totals(report)
                    if report.totals.values.allSatisfy({ $0 == 0 }) {
                        Text("Nothing recorded for this range yet.")
                            .foregroundStyle(Palette.muted)
                            .padding(.vertical, 40)
                    } else {
                        timeOfDay(report)
                        if model.range != .day { byDay(report) }
                        HStack(alignment: .top, spacing: 20) {
                            apps(report).frame(maxWidth: .infinity)
                            VStack(spacing: 20) {
                                agents(report)
                                meetings(report)
                            }
                            .frame(width: 320)
                        }
                    }
                } else {
                    ProgressView().controlSize(.small).padding(.vertical, 40)
                }
                about
            }
            .padding(.horizontal, 32)
            .padding(.top, 36)
            .padding(.bottom, 40)
        }
        .background(Palette.bg)
        .foregroundStyle(Palette.text)
        .preferredColorScheme(.dark)
    }

    // MARK: - Header

    private var header: some View {
        HStack(alignment: .firstTextBaseline) {
            VStack(alignment: .leading, spacing: 6) {
                Text("Your activity").font(.system(size: 30, weight: .medium))
                Text(rangeTitle).foregroundStyle(Palette.text2)
            }
            Spacer()
            HStack(spacing: 10) {
                Picker("Range", selection: $model.range) {
                    ForEach(ActivityRange.allCases, id: \.self) { Text($0.label).tag($0) }
                }
                .pickerStyle(.segmented)
                .labelsHidden()
                .frame(width: 220)
                Button { model.step(-1) } label: { Image(systemName: "chevron.left") }
                Button { model.step(1) } label: { Image(systemName: "chevron.right") }
                    .disabled(model.includesToday)
                Button("Today") { model.goToToday() }.disabled(model.includesToday).fixedSize()
            }
        }
    }

    private var rangeTitle: String {
        let f = DateFormatter()
        switch model.range {
        case .day:
            f.dateFormat = "EEEE, MMM d"
            return f.string(from: model.interval.start)
        case .week:
            f.dateFormat = "MMM d"
            let end = model.interval.end.addingTimeInterval(-1)
            return "\(f.string(from: model.interval.start)) to \(f.string(from: end))"
        case .month:
            f.dateFormat = "MMMM yyyy"
            return f.string(from: model.interval.start)
        }
    }

    // MARK: - Totals

    private func totals(_ report: ActivityReport) -> some View {
        HStack(spacing: 0) {
            ForEach(Array(ActivitySeries.allCases.enumerated()), id: \.element) { index, series in
                let total = report.totals[series] ?? 0
                VStack(alignment: .leading, spacing: 10) {
                    SeriesLabel(series: series)
                    Text(Time.duration(total))
                        .font(.system(size: 44, weight: .light))
                        .monospacedDigit()
                    if model.range != .day {
                        Text("\(Time.duration(total / report.elapsedDays(now: Date()))) a day on average")
                            .font(.callout).foregroundStyle(Palette.muted)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.leading, index == 0 ? 0 : 24)
                .overlay(alignment: .leading) {
                    if index > 0 { Rectangle().fill(Palette.line).frame(width: 1) }
                }
            }
        }
        .padding(.vertical, 24)
        .overlay(alignment: .top) { Rectangle().fill(Palette.line).frame(height: 1) }
        .overlay(alignment: .bottom) { Rectangle().fill(Palette.line).frame(height: 1) }
    }

    // MARK: - Time of day

    private func timeOfDay(_ report: ActivityReport) -> some View {
        Panel(title: "Time of day", note: model.range == .day ? "Minutes per hour" : "Each square is one hour") {
            if model.range == .day {
                Chart {
                    ForEach(ActivitySeries.allCases, id: \.self) { series in
                        ForEach(0..<24, id: \.self) { hour in
                            BarMark(x: .value("Hour", Time.hourKey(hour)), y: .value("Minutes", Double(report.hourly[series]![hour]) / 60))
                                .foregroundStyle(by: .value("Series", series.label))
                                .position(by: .value("Series", series.label), span: .ratio(0.85))
                                .cornerRadius(2)
                        }
                    }
                }
                .chartForegroundStyleScale(["Human": Palette.human, "Agents": Palette.agents, "Meetings": Palette.meetings])
                .chartXScale(domain: (0..<24).map(Time.hourKey))
                .chartXAxis {
                    AxisMarks(values: stride(from: 0, to: 24, by: 3).map(Time.hourKey)) { value in
                        AxisValueLabel { Text(Time.shortHour(Int(value.as(String.self) ?? "0") ?? 0)) }
                    }
                }
                .chartYAxis {
                    AxisMarks(position: .leading) { _ in
                        AxisGridLine().foregroundStyle(Palette.line)
                        AxisValueLabel()
                    }
                }
                .chartLegend(position: .top, alignment: .leading, spacing: 16)
                .frame(height: 220)
            } else {
                VStack(alignment: .leading, spacing: 14) {
                    Picker("Series", selection: $model.heatSeries) {
                        ForEach(ActivitySeries.allCases, id: \.self) { Text($0.label).tag($0) }
                    }
                    .pickerStyle(.segmented)
                    .labelsHidden()
                    .frame(width: 300)
                    Heatmap(report: report, series: model.heatSeries)
                }
            }
        }
    }

    private func byDay(_ report: ActivityReport) -> some View {
        let keyFormat: DateFormatter = { let f = DateFormatter(); f.dateFormat = report.days.count > 7 ? "d" : "EEE d"; return f }()
        let keys = report.days.map { keyFormat.string(from: $0) }
        let every = report.days.count > 7 ? 3 : 1
        return Panel(title: "By day", note: "Hours") {
            Chart {
                ForEach(ActivitySeries.allCases, id: \.self) { series in
                    ForEach(Array(keys.enumerated()), id: \.offset) { index, key in
                        BarMark(x: .value("Day", key), y: .value("Hours", Double(report.daily[series]![index]) / 3600))
                            .foregroundStyle(by: .value("Series", series.label))
                            .position(by: .value("Series", series.label), span: .ratio(0.85))
                            .cornerRadius(2)
                    }
                }
            }
            .chartXScale(domain: keys)
            .chartXAxis {
                AxisMarks(values: keys.enumerated().filter { $0.offset % every == 0 }.map(\.element)) { _ in AxisValueLabel() }
            }
            .chartForegroundStyleScale(["Human": Palette.human, "Agents": Palette.agents, "Meetings": Palette.meetings])
            .chartYAxis {
                AxisMarks(position: .leading) { _ in
                    AxisGridLine().foregroundStyle(Palette.line)
                    AxisValueLabel()
                }
            }
            .chartLegend(position: .top, alignment: .leading, spacing: 16)
            .frame(height: 200)
        }
    }

    // MARK: - Apps, agents, meetings

    private func apps(_ report: ActivityReport) -> some View {
        Panel(title: "Apps", note: "Click one to see when you used it") {
            if report.apps.isEmpty {
                Text("No app time in this range.").foregroundStyle(Palette.muted)
            } else {
                let total = max(1, report.apps.reduce(0) { $0 + $1.seconds })
                let top = report.apps.first?.seconds ?? 1
                VStack(spacing: 0) {
                    ForEach(report.apps.filter { $0.seconds >= 30 }.prefix(10)) { app in
                        Button {
                            model.selectedApp = model.selectedApp == app.id ? nil : app.id
                        } label: {
                            UsageRow(item: app, color: Palette.human, fraction: Double(app.seconds) / Double(top),
                                     trailing: "\(Int((Double(app.seconds) / Double(total) * 100).rounded()))%",
                                     selected: model.selectedApp == app.id)
                        }
                        .buttonStyle(.plain)
                        if model.selectedApp == app.id {
                            HourlyBars(hourly: app.hourly, color: Palette.human)
                                .padding(.vertical, 10)
                        }
                    }
                }
            }
        }
    }

    private func agents(_ report: ActivityReport) -> some View {
        Panel(title: "Agents", note: report.peakParallel > 0 ? "Most at once: \(report.peakParallel)" : nil) {
            if report.agents.isEmpty {
                Text("No agent time in this range.").foregroundStyle(Palette.muted)
            } else {
                let top = report.agents.first?.seconds ?? 1
                VStack(spacing: 0) {
                    ForEach(report.agents) { agent in
                        UsageRow(item: agent, color: Palette.agents, fraction: Double(agent.seconds) / Double(top),
                                 trailing: nil, selected: false)
                    }
                }
            }
        }
    }

    private func meetings(_ report: ActivityReport) -> some View {
        Panel(title: "Meetings", note: nil) {
            if report.meetingApps.isEmpty {
                Text("No calls in this range.").foregroundStyle(Palette.muted)
            } else {
                let top = report.meetingApps.first?.seconds ?? 1
                VStack(spacing: 0) {
                    ForEach(report.meetingApps) { app in
                        UsageRow(item: app, color: Palette.meetings, fraction: Double(app.seconds) / Double(top),
                                 trailing: nil, selected: false)
                    }
                }
            }
        }
    }

    private var about: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("About this data").font(.headline)
            Text("""
                Everything here comes from this Mac and stays on it. Arena records which app is in front each \
                minute, minutes with keyboard or mouse input, call time and coding-agent time. It never records \
                which keys you press: it only checks how long it has been since your last input. Window titles \
                are recorded only if you turn them on, and are kept for 7 days. Change how long history is kept, \
                or delete it, from the menu bar under Privacy.
                """)
            .foregroundStyle(Palette.muted)
            .fixedSize(horizontal: false, vertical: true)
        }
        .font(.callout)
        .frame(maxWidth: 720, alignment: .leading)
    }
}

// MARK: - Pieces

private struct Panel<Content: View>: View {
    let title: String
    let note: String?
    @ViewBuilder let content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            HStack(alignment: .firstTextBaseline) {
                Text(title).font(.system(size: 16, weight: .medium))
                Spacer()
                if let note { Text(note).font(.callout).foregroundStyle(Palette.muted) }
            }
            content
        }
        .padding(22)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Palette.panel, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 20, style: .continuous).stroke(Color.white.opacity(0.04)))
    }
}

private struct SeriesLabel: View {
    let series: ActivitySeries
    var body: some View {
        HStack(spacing: 8) {
            Circle().fill(Palette.color(series)).frame(width: 8, height: 8)
            Text(series.label).foregroundStyle(Palette.text2)
        }
    }
}

private struct UsageRow: View {
    let item: UsageItem
    let color: Color
    let fraction: Double
    let trailing: String?
    let selected: Bool

    var body: some View {
        VStack(spacing: 8) {
            HStack(spacing: 12) {
                Text(String(item.name.first(where: { $0.isLetter || $0.isNumber }) ?? "•").uppercased())
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(Palette.text2)
                    .frame(width: 26, height: 26)
                    .background(Palette.raised, in: RoundedRectangle(cornerRadius: 7))
                Text(item.name).lineLimit(1)
                Spacer()
                Text(Time.duration(item.seconds)).monospacedDigit().foregroundStyle(Palette.text2)
                if let trailing {
                    Text(trailing).monospacedDigit().foregroundStyle(Palette.muted).frame(width: 40, alignment: .trailing)
                }
            }
            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    Capsule().fill(Palette.line)
                    Capsule().fill(color).frame(width: max(3, geo.size.width * fraction))
                }
            }
            .frame(height: 3)
        }
        .padding(.vertical, 9)
        .padding(.horizontal, 8)
        .background(selected ? Palette.raised : .clear, in: RoundedRectangle(cornerRadius: 10))
        .contentShape(Rectangle())
    }
}

private struct HourlyBars: View {
    let hourly: [Int]
    let color: Color

    var body: some View {
        Chart {
            ForEach(0..<24, id: \.self) { hour in
                BarMark(x: .value("Hour", hour), y: .value("Minutes", Double(hourly[hour]) / 60))
                    .foregroundStyle(color)
                    .cornerRadius(2)
            }
        }
        .chartXScale(domain: -0.5...23.5)
        .chartXAxis {
            AxisMarks(values: [0, 6, 12, 18]) { value in
                AxisValueLabel { Text(Time.shortHour(value.as(Int.self) ?? 0)) }
            }
        }
        .chartYAxis {
            AxisMarks(position: .leading) { _ in
                AxisGridLine().foregroundStyle(Palette.line)
                AxisValueLabel()
            }
        }
        .frame(height: 110)
        .padding(.horizontal, 8)
    }
}

/// Day × hour grid for one series; brighter = more time in that hour.
private struct Heatmap: View {
    let report: ActivityReport
    let series: ActivitySeries

    var body: some View {
        let grid = report.grid[series] ?? []
        let peak = max(1, grid.flatMap { $0 }.max() ?? 1)
        let color = Palette.color(series)
        let dayFormat: DateFormatter = {
            let f = DateFormatter()
            f.dateFormat = report.days.count > 7 ? "MMM d" : "EEE"
            return f
        }()
        VStack(alignment: .leading, spacing: 3) {
            HStack(spacing: 3) {
                Text("").frame(width: 56)
                ForEach(0..<24, id: \.self) { hour in
                    Text(hour % 3 == 0 ? Time.hour(hour) : "")
                        .font(.system(size: 9)).foregroundStyle(Palette.muted)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .fixedSize()
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
            ForEach(Array(report.days.enumerated()), id: \.offset) { index, day in
                HStack(spacing: 3) {
                    Text(dayFormat.string(from: day))
                        .font(.system(size: 11)).foregroundStyle(Palette.muted)
                        .frame(width: 56, alignment: .leading)
                    ForEach(0..<24, id: \.self) { hour in
                        let sec = index < grid.count ? grid[index][hour] : 0
                        RoundedRectangle(cornerRadius: 3)
                            .fill(sec > 0 ? color.opacity(0.2 + 0.8 * Double(sec) / Double(peak)) : Palette.raised)
                            .frame(height: report.days.count > 7 ? 14 : 22)
                            .help("\(dayFormat.string(from: day)) \(Time.hour(hour)): \(Time.duration(sec))")
                    }
                }
            }
        }
    }
}
