Set-Location 'D:\Bilibili_User_Personality'
# Tuned coverage loop v4 to drain the weak pool toward 100%.
#
# Why gate -AllowNewTerms: v3 proved that continuous new-keyword inflow
# (~50 new weak terms/cycle) matches the prune outflow (~48/cycle), so the
# net weak drain is flat and 100% is unreachable. Temporarily gating new-term
# ADDITION lets the existing 2134 weak terms drain. Comments + danmaku are
# STILL fully harvested for evidence on existing terms (CommentPages and
# INCLUDE_DANMAKU are independent of AllowNewTerms). Once coverage approaches
# 100%, -AllowNewTerms can be re-enabled to resume accepting new keywords.
#
# Config: MaxQueries 48, QueryVariantsPerTerm 1, PruneExhaustedAfter 2,
# PruneIncludePartial, danmaku ON, CommentPages 1, MaxCycles 1000.
# NOTE: -AllowNewTerms omitted -> existing dictionary terms only.
.\run-bilibili-auto-coverage.ps1 -ResetHarvestState -MaxCycles 1000 -MaxQueries 48 -DiscoveryMode search -CommentPages 1 -DiscoveryLimit 4 -QueryTimeoutSeconds 600 -QueryConcurrency 5 -QueryVariantsPerTerm 1 -PruneExhaustedAfter 2 -PruneIncludePartial
