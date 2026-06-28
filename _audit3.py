import os

base = r"D:\Bilibili_User_Personality"
files = [
    "src/main.jsx", "src/components/SearchBox.jsx", "src/admin/index.jsx", "src/admin/AdminLogin.jsx",
    "src/admin/AdminDashboard.jsx", "src/admin/TermTable.jsx", "src/admin/TermReview.jsx",
    "src/admin/StatsBar.jsx", "src/admin/admin.css", "server/middleware/adminAuth.js",
    "server/routes/admin.js", "server/data/adminReviews.json", "admin.html", "vite.config.js"
]
for f in files:
    p = os.path.join(base, f)
    ok = os.path.exists(p)
    print("  " + ("OK" if ok else "MISSING") + ": " + f)

print()
with open(os.path.join(base, "src/main.jsx"), "r", encoding="utf-8") as f:
    main = f.read()
items = ["import SearchBox", "handlePublicSearch", "analyze-uid", "admin-link", "function BarChartSmallMultiples", "/api/bilibili"]
for item in items:
    print("  main.jsx contains \"" + item + "\": " + ("YES" if item in main else "NO"))

# Check admin index has createRoot
with open(os.path.join(base, "src/admin/index.jsx"), "r", encoding="utf-8") as f:
    admin_idx = f.read()
print("  admin/index.jsx has createRoot: " + ("YES" if "createRoot" in admin_idx else "NO"))

# Check server has admin route
with open(os.path.join(base, "server/index.js"), "r", encoding="utf-8") as f:
    srv = f.read()
print("  server/index.js has admin route: " + ("YES" if ("admin" in srv and "app.route" in srv) else "NO"))

# Build check
import subprocess
result = subprocess.run(["npx", "vite", "build"], cwd=base, capture_output=True, text=True, timeout=30)
print("\n  Build: " + ("PASS" if result.returncode == 0 else "FAIL"))
if result.returncode == 0:
    # Check admin bundle size
    import glob
    admin_js = glob.glob(os.path.join(base, "dist", "assets", "admin-*.js"))
    if admin_js:
        sz = os.path.getsize(admin_js[0])
        print("  Admin JS bundle: " + str(sz) + " bytes (" + ("OK" if sz > 5000 else "TOO SMALL") + ")")
