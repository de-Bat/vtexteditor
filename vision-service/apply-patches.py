"""Apply compatibility patches to installed packages. Run after pip install -r requirements.txt"""
import shutil
import sys
from pathlib import Path

patches_dir = Path(__file__).parent / "patches"


def find_site_packages():
    for p in sys.path:
        if "site-packages" in p:
            return Path(p)
    raise RuntimeError("site-packages not found in sys.path")


def apply():
    sp = find_site_packages()
    targets = [
        ("df_io.py", sp / "df" / "io.py"),
    ]
    for src_name, dst in targets:
        src = patches_dir / src_name
        if not dst.exists():
            print(f"SKIP {dst} (not installed)")
            continue
        shutil.copy2(src, dst)
        print(f"Patched {dst}")


if __name__ == "__main__":
    apply()
