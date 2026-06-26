"""Filter discovered Bilibili tags, keep history-relevant ones, and generate the updated seed list."""

import json
import re

# Current seeds from bilibiliHistoryTags.js
current_seeds = [
    "历史", "中国历史", "世界历史", "近代史", "古代史",
    "历史科普", "历史解说", "历史人物", "历史事件",
    "战争史", "军事历史", "考古", "文物", "博物馆",
    "明朝", "清朝", "三国", "秦汉", "唐朝", "宋朝", "民国",
]

# Load discovered tags
with open(".claude/bilibili_discovered_tags.json", "r", encoding="utf-8") as f:
    discovered = set(json.load(f)["tags"])

# Noise patterns - tags that are clearly NOT history-related
noise_patterns = [
    # Platform promotions / generic Bilibili tags
    r"^\d{4}.*",  # Year-based promo tags
    r"^B站.*", r"B站宝藏",
    r"^bilibili", r"Bilibili",
    r"万物研究所",
    r"知识分享官",
    r"社科人文",
    r"宝藏知识",
    r"趣味科普人文",
    r"人人都能聊影视",
    r"影视指南官",
    r"影娱",
    r"小剧场",
    r"^打卡挑战",
    r"粉丝音乐",
    r"电台新星",
    r"原神", r"崩坏",
    r"上淘宝",
    r"春节档",
    r"好剧好片",

    # Game-related
    r"炉石", r"桌游棋牌", r"策略游戏", r"游戏", r"steam",
    r"钢铁雄心", r"三国杀", r"全面战争",
    r"崩坏：", r"原神",

    # Tech/generic not history
    r"^4K$", r"^BUG$", r"^HIFI$", r"^HiRes$", r"^cover$",
    r"^Playlist$", r"^YouDub$",
    r"^字幕$", r"^无损$", r"^弹唱$", r"^唱歌$", r"^合唱$",
    r"^发烧音乐", r"^音乐", r"^歌单", r"^听歌",
    r"^同名专辑", r"^纯音乐", r"^翻唱", r"^女声",
    r"^HIFI", r"^电纸本", r"^汉王",
    r"^叶祖新", r"^刘诗诗", r"^吴奇隆", r"^林更新", r"^倪大红", r"^陈宝国",
    r"^异灵术", r"^戴佳伟", r"^狗贼", r"^狮酱",
    r"^张雪峰", r"^董宇辉",

    # Very generic
    r"^学习$", r"^复习$", r"^考试$", r"^知识点$",
    r"^初中$", r"^高中$", r"^大学$", r"^八年级$", r"^七年级$",
    r"^下册$", r"^期末", r"^重点$",
    r"^娱乐$", r"^生活$", r"^日常$", r"^搞笑$", r"^热血$", r"^高燃$",
    r"^小说$", r"^电影$", r"^电视剧$", r"^纪录片$",
    r"^原创$", r"^自制", r"^必剪",
    r"^动画$", r"^国创$",
    r"^星海$", r"^镜头$", r"^中国$", r"^世界$", r"^宇宙$",
    r"^逻辑$", r"^框架$", r"^背景设定", r"^设计$",
    r"^命运$", r"^执念$", r"^生命$", r"^道德$",
    r"^美食$", r"^女孩$", r"^儿童$",
    r"^推荐", r"^持续更新", r"^合集$",
    r"^故事$", r"^剧情$",
    r"^课堂$", r"^课程$",
    r"^解说$", r"^讲解$", r"^记录$",
]

def is_noise(tag):
    for pattern in noise_patterns:
        if re.match(pattern, tag):
            return True
    return False

# Filter
filtered_tags = {tag for tag in discovered if not is_noise(tag)}
# Add current seeds (they might not all appear in discovered tags)
filtered_tags.update(current_seeds)

# Sort
final_tags = sorted(filtered_tags)

print(f"Current seeds: {len(current_seeds)}")
print(f"Discovered API tags: {len(discovered)}")
print(f"Filtered (history-relevant): {len(filtered_tags)}")

# Categorize
dynasties = []
figures = []
events = []
topics = []
wars = []
archaeology = []
other = []

dynasty_names = {"夏朝", "商朝", "周朝", "秦代", "秦朝", "汉代", "汉朝", "三国", "晋朝",
    "南北朝", "隋朝", "唐代", "唐朝", "五代十国", "宋朝", "元朝", "明朝", "清朝", "民国",
    "大唐", "盛唐", "晚唐", "中晚唐", "大明", "大清", "秦汉", "宋史", "明史", "唐史",
    "华夏", "中华", "中世纪", "古希腊", "罗马", "雅典", "日本战国", "幕末", "战国",
    "古代", "远古", "史前", "远古巨兽", "史前巨兽"}

figure_names = {"秦始皇", "武则天", "李世民", "李渊", "李隆基", "赵匡胤", "赵构",
    "嘉靖", "海瑞", "岳飞", "苏轼", "范仲淹", "多尔衮", "织田信长", "拿破仑",
    "亚历山大大帝", "康熙", "雍正", "乾隆", "洪秀全", "曾国藩", "李鸿章",
    "西乡隆盛", "德川庆喜", "土方岁三", "园部和一郎", "杉谷善住坊",
    "大贺茂", "罗卓英", "周原", "孙中山"}

event_names = {"安史之乱", "玄武门之变", "杯酒释兵权", "庆历新政", "开元盛世",
    "贞观之治", "抗日战争", "第一次世界大战", "二战", "一战", "冷战",
    "黄袍加身", "英荷战争", "俄乌冲突", "俄乌战争", "伯罗奔尼撒战争",
    "会津战争", "箱馆战争", "鸟羽伏见之战", "上高会战", "上高大捷",
    "新选组", "满清入关", "满清余孽", "进击的巨人", "觉醒年代",
    "高加索战争"}

war_names = {"战争", "战役", "战略", "军事", "战争史", "军事历史", "一战", "二战",
    "抗日战争", "第一次世界大战", "冷战", "解放军", "全面战争", "我的战争",
    "英荷战争", "俄乌冲突", "俄乌战争", "伯罗奔尼撒战争", "会津战争",
    "箱馆战争", "鸟羽伏见之战", "上高会战", "上高大捷", "高加索战争"}

archaeology_names = {"考古", "文物", "博物馆", "良渚文化", "红山文化", "金沙",
    "殷墟", "马王堆", "秦始皇陵", "河姆渡", "法门寺", "陵西大墓", "古墓",
    "金沙", "周原", "科技考古", "考古学", "考古专业", "考古行业"}

for tag in final_tags:
    if tag in dynasty_names: dynasties.append(tag)
    elif tag in figure_names: figures.append(tag)
    elif tag in event_names: events.append(tag)
    elif tag in war_names: wars.append(tag)
    elif tag in archaeology_names: archaeology.append(tag)
    elif any(kw in tag for kw in ["历史", "古代", "近代", "现代史"]): topics.append(tag)
    else: other.append(tag)

print(f"  Dynasties/Periods: {len(dynasties)}")
print(f"  Figures: {len(figures)}")
print(f"  Events: {len(events)}")
print(f"  Wars/Military: {len(wars)}")
print(f"  Archaeology: {len(archaeology)}")
print(f"  Topics: {len(topics)}")
print(f"  Other: {len(other)}")

# Write the final seed list for JS code
print()
print("=== NEW SEED LIST (for JS code) ===")
print("const DEFAULT_HISTORY_TAG_SEEDS = [")
for tag in final_tags:
    print(f"  '{tag}',")
print("];")

# Also save to JSON
output = {
    "totalSeeds": len(final_tags),
    "dynasties": sorted(dynasties),
    "figures": sorted(figures),
    "events": sorted(events),
    "wars": sorted(wars),
    "archaeology": sorted(archaeology),
    "topics": sorted(topics),
    "other": sorted(other),
    "allSeeds": sorted(final_tags),
}
with open(".claude/filtered_seeds.json", "w", encoding="utf-8") as f:
    json.dump(output, f, ensure_ascii=False, indent=2)
print()
print(f"Saved filtered seeds to .claude/filtered_seeds.json ({len(final_tags)} total)")
