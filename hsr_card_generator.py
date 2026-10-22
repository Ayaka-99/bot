# -*- coding: utf-8 -*-
"""
Honkai: Star Rail Character Card Generator
Bridge script between Node.js Discord Bot and DEViantUA/StarRailCard.
"""

import sys
import os
import glob
import json
import asyncio
import argparse

# Ensure standard output uses UTF-8 encoding
if sys.stdout.encoding != 'utf-8':
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except Exception:
        pass

# 自動探測並掛載常用與使用者本地的 Python site-packages 路徑 (相容 Linux pip install --user 與虛擬環境)
home_dir = os.path.expanduser("~")
candidate_paths = [
    os.path.join(home_dir, ".local", "lib"),
    "/usr/local/lib",
    "/usr/lib",
]
for base_dir in candidate_paths:
    if os.path.isdir(base_dir):
        for site_pkg in glob.glob(os.path.join(base_dir, "python*", "site-packages")):
            if os.path.isdir(site_pkg) and site_pkg not in sys.path:
                sys.path.insert(0, site_pkg)
        for dist_pkg in glob.glob(os.path.join(base_dir, "python*", "dist-packages")):
            if os.path.isdir(dist_pkg) and dist_pkg not in sys.path:
                sys.path.insert(0, dist_pkg)

try:
    import starrailcard
except ImportError as e:
    print("__JSON_RESULT_START__")
    print(json.dumps({
        "success": False,
        "error": "IMPORT_ERROR",
        "message": f"缺少 starrailcard 模組: {e}。請在伺服器終端機執行: pip3 install --break-system-packages starrailcard pillow python-magic"
    }, ensure_ascii=False))
    print("__JSON_RESULT_END__")
    sys.exit(1)


async def get_showcase_list(uid: int | str):
    """Fetch player showcase characters list without rendering images."""
    try:
        api = starrailcard.api.ApiMiHoMo(uid, lang="cht")
        data = await api.get(parse=False)
        
        player_raw = data.get("player", {})
        characters_raw = data.get("characters", [])
        
        player_info = {
            "uid": str(uid),
            "nickname": player_raw.get("nickname", "未知開拓者"),
            "level": player_raw.get("level", 1),
            "signature": player_raw.get("signature", ""),
            "world_level": player_raw.get("world_level", 0),
            "avatar": player_raw.get("avatar", {}).get("icon", "")
        }
        
        char_list = []
        for c in characters_raw:
            char_list.append({
                "id": str(c.get("id")),
                "name": c.get("name", "未知角色"),
                "rarity": c.get("rarity", 4),
                "level": c.get("level", 1),
                "promotion": c.get("promotion", 0),
                "rank": c.get("rank", 0),  # 星魂
                "element": c.get("element", {}).get("name", "") if isinstance(c.get("element"), dict) else "",
                "path": c.get("path", {}).get("name", "") if isinstance(c.get("path"), dict) else "",
                "icon": c.get("icon", ""),
            })
            
        return {
            "success": True,
            "player": player_info,
            "characters": char_list
        }
    except Exception as e:
        err_msg = str(e)
        if "User not found" in err_msg:
            return {"success": False, "error": "USER_NOT_FOUND", "message": f"找不到 UID [{uid}] 的玩家資料，請確認 UID 是否正確。"}
        if "Invalid uid" in err_msg:
            return {"success": False, "error": "INVALID_UID", "message": f"無效的星穹鐵道 UID [{uid}]，請輸入 9 位數遊戲 UID。"}
        if "Queue timeout" in err_msg:
            return {"success": False, "error": "QUEUE_TIMEOUT", "message": "MiHoMo API 查詢佇列繁忙逾時，請稍候再試一次。"}
        return {"success": False, "error": "API_ERROR", "message": f"抓取漫遊簽證資料失敗: {err_msg}"}


def get_chinese_font_path():
    """尋找系統可用的中文字體路徑以解決繁中圖卡亂碼/豆腐塊 (????) 問題"""
    candidates = []
    
    # 1. 本地 bot 目錄自帶字體 (如有)
    bot_dir = os.path.dirname(os.path.abspath(__file__))
    candidates.extend([
        os.path.join(bot_dir, "font.ttf"),
        os.path.join(bot_dir, "font.otf"),
        os.path.join(bot_dir, "NotoSansTC.ttf"),
    ])
    
    # 2. Linux (Ubuntu / Debian) 常見中文字體路徑
    candidates.extend([
        "/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc",
        "/usr/share/fonts/truetype/wqy/wqy-microhei.ttc",
        "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
        "/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc",
        "/usr/share/fonts/google-noto-cjk/NotoSansCJK-Regular.ttc",
        "/usr/share/fonts/cjkuni-uming/uming.ttc",
    ])
    
    # 3. Windows 常見繁中/簡中字體路徑
    windir = os.environ.get("WINDIR", "C:\\Windows")
    candidates.extend([
        os.path.join(windir, "Fonts", "msjh.ttc"),       # 微軟正黑體
        os.path.join(windir, "Fonts", "msjhbd.ttc"),
        os.path.join(windir, "Fonts", "msyh.ttc"),       # 微軟雅黑
        os.path.join(windir, "Fonts", "simhei.ttf"),      # 黑體
    ])
    
    for c in candidates:
        if os.path.isfile(c):
            return c
            
    # 4. 若上述特定路徑都沒命中，搜尋 Linux /usr/share/fonts 下的 CJK 字體
    if os.path.isdir("/usr/share/fonts"):
        for root, dirs, files in os.walk("/usr/share/fonts"):
            for f in files:
                lower = f.lower()
                if (lower.endswith(".ttf") or lower.endswith(".ttc") or lower.endswith(".otf")) and \
                   ("cjk" in lower or "zenhei" in lower or "microhei" in lower or "notosans" in lower or "hei" in lower):
                    return os.path.join(root, f)

    return None


async def generate_card(uid: int | str, char_query: str = None, style: int = 2, output_path: str = None):
    """Generate character card image using StarRailCard."""
    # 1. 取得展示櫃列表以比對角色
    showcase = await get_showcase_list(uid)
    if not showcase.get("success"):
        return showcase
    
    characters = showcase.get("characters", [])
    if not characters:
        return {
            "success": False,
            "error": "EMPTY_SHOWCASE",
            "message": f"開拓者 【{showcase['player']['nickname']}】 (UID: {uid}) 的漫遊簽證內沒有公開展示任何角色，請先在遊戲內設定展示角色。"
        }
    
    # 2. 比對目標角色
    target_char = None
    if char_query:
        query = char_query.strip().lower()
        # 先以 ID 匹配
        for c in characters:
            if c["id"] == query:
                target_char = c
                break
        # 再以角色名稱精確或部分匹配
        if not target_char:
            for c in characters:
                if query == c["name"].lower() or query in c["name"].lower():
                    target_char = c
                    break
        # 若仍未找到，提示目前展示櫃中有的角色
        if not target_char:
            available_names = "、".join([c["name"] for c in characters])
            return {
                "success": False,
                "error": "CHAR_NOT_FOUND",
                "message": f"在 UID [{uid}] 的展示櫃中找不到「{char_query}」！\n目前展示的角色有：{available_names}。\n請確認名稱或在遊戲內更換漫遊簽證展示角色。"
            }
    else:
        # 預設使用展示櫃第 1 位看板角色
        target_char = characters[0]
        
    char_id = target_char["id"]
    char_name = target_char["name"]
    
    # 3. 準備輸出路徑
    if not output_path:
        out_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "cards_temp")
        os.makedirs(out_dir, exist_ok=True)
        output_path = os.path.join(out_dir, f"hsr_card_{uid}_{char_id}_s{style}.png")
    else:
        out_dir = os.path.dirname(os.path.abspath(output_path))
        if out_dir:
            os.makedirs(out_dir, exist_ok=True)

    # 4. 取得中文字體並呼叫 starrailcard 進行繁中圖卡渲染
    chinese_font = get_chinese_font_path()
    try:
        async with starrailcard.Card(lang="cht", character_id=str(char_id), seeleland=True, user_font=chinese_font) as card_builder:
            data = await card_builder.create(uid, style=style)
            
            if not data.card or len(data.card) == 0:
                return {
                    "success": False,
                    "error": "RENDER_EMPTY",
                    "message": f"生成 【{char_name}】 面板卡失敗：圖卡數據為空。"
                }
                
            first_card = data.card[0]
            pil_img = first_card.get("card") if isinstance(first_card, dict) else getattr(first_card, "card", None)
            
            if not pil_img:
                return {
                    "success": False,
                    "error": "RENDER_NO_IMAGE",
                    "message": f"生成 【{char_name}】 面板卡失敗：未能取得圖片渲染對象。"
                }
                
            pil_img.save(output_path, "PNG")
            
            return {
                "success": True,
                "uid": str(uid),
                "player": showcase["player"],
                "character": target_char,
                "all_characters": characters,
                "style": style,
                "image_path": os.path.abspath(output_path)
            }
    except Exception as e:
        return {
            "success": False,
            "error": "RENDER_ERROR",
            "message": f"圖卡渲染過程發生異常: {str(e)}"
        }


def main():
    parser = argparse.ArgumentParser(description="崩壞：星穹鐵道角色練度面板卡生成器")
    parser.add_argument("--uid", type=str, required=True, help="星穹鐵道 9 碼遊戲 UID")
    parser.add_argument("--char", type=str, default=None, help="目標角色名稱或 ID (選填)")
    parser.add_argument("--style", type=int, default=2, choices=[1, 2], help="圖卡排版風格 (1: 經典遺器評分版, 2: 精裝大立繪寬版)")
    parser.add_argument("--out", type=str, default=None, help="輸出圖片檔案路徑")
    parser.add_argument("--list", action="store_true", help="僅獲取展示櫃角色清單 JSON")
    
    args = parser.parse_args()
    
    if args.list:
        result = asyncio.run(get_showcase_list(args.uid))
    else:
        result = asyncio.run(generate_card(args.uid, args.char, args.style, args.out))
        
    print("__JSON_RESULT_START__")
    print(json.dumps(result, ensure_ascii=False))
    print("__JSON_RESULT_END__")


if __name__ == "__main__":
    main()
