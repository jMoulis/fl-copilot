# Dark Premium visual system

Visual reference images live in `../assets/`; written behavior rules override imagery. Proposed palette to adapt to existing theme tokens: background `#07120F`, surface `#13231D`, elevated `#1D3429`, accent `#4DDC91`, primary text `#F0FFF6`, secondary text `#B4C9BE`, warning `#E6A05A`, critical `#F07770`.

Reusable components: `AppTabBar`, `ScreenHeader`, `PeriodGranularityControl`, `PeriodNavigator`, `PeriodPickerSheet`, `KpiHero`, `ComparisonLabel`, `CoverageBadge`, `AnalyticsChart`, `DrillBreadcrumb`, `FilterSheet`, `OfflineBadge`, `EmptyState`, `ConfirmDialog`.

Respect safe areas, reduced motion, dynamic type, VoiceOver/TalkBack, focus order, and keyboard avoidance. Target at least 44x44pt iOS and 48x48dp Android where possible. Use color + icon/text for status, not color alone. Favor quick, restrained transitions and avoid decorative animation during urgent shop-floor use.
