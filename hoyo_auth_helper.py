# -*- coding: utf-8 -*-
"""
HoYoLAB Account/Password Authentication Helper
Utilizes genshin.py to perform RSA encryption and login exchange.
Strict security: Passwords exist solely in memory during execution and are never logged or stored.
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

# 自動探測並掛載常用與使用者本地的 Python site-packages 路徑
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
    import genshin
    from genshin.models.auth.geetest import SessionMMT, SessionMMTv4
    from genshin.models.auth.cookie import WebLoginResult, AppLoginResult
    from genshin.models.auth.verification import ActionTicket
except ImportError as e:
    print("__AUTH_RESULT_START__")
    print(json.dumps({
        "success": False,
        "error": "IMPORT_ERROR",
        "message": f"缺少 genshin 模組: {e}。請在終端機執行: pip3 install genshin rsa"
    }, ensure_ascii=False))
    print("__AUTH_RESULT_END__")
    sys.exit(1)


async def custom_geetest_solver(session_mmt):
    """Prevent blocking on headless server when captcha is triggered."""
    raise Exception("GEETEST_TRIGGERED")


async def login_step1(account: str, password: str):
    """
    第一階段：嘗試以帳密向 HoYoLAB 官方換取憑證
    優先嘗試 Web 登入，若遇到雙重驗證則切換至 App 驗證碼流程
    """
    client = genshin.Client(region=genshin.Region.OVERSEAS)

    # 1. 優先嘗試 Web 登入端點 (最直接，常不需要驗證碼)
    try:
        web_result = await client.os_login_with_password(
            account,
            password,
            geetest_solver=custom_geetest_solver
        )
        if isinstance(web_result, WebLoginResult):
            cookie_dict = {}
            for k in ["ltoken_v2", "ltuid_v2", "cookie_token_v2", "account_id_v2"]:
                val = getattr(web_result, k, None)
                if val:
                    cookie_dict[k] = val
            
            # 組裝乾淨標準的 Cookie 字串
            cookie_str = "; ".join([f"{k}={v}" for k, v in cookie_dict.items()])
            return {
                "success": True,
                "status": "SUCCESS",
                "cookie": cookie_str,
                "cookie_dict": cookie_dict,
                "message": "登入成功！已成功換取簽到 Cookie 憑證。"
            }
    except genshin.errors.AccountLoginFail:
        return {"success": False, "error": "INVALID_PASSWORD", "message": "密碼錯誤，請確認後重新輸入！"}
    except genshin.errors.AccountDoesNotExist:
        return {"success": False, "error": "ACCOUNT_NOT_FOUND", "message": "該 HoYoLAB 帳號不存在，請確認信箱或使用者名稱是否正確！"}
    except Exception as e:
        err_str = str(e)
        if "GEETEST_TRIGGERED" not in err_str:
            # 非驗證碼錯誤，先嘗試 App 登入端點
            pass

    # 2. 若 Web 登入觸發安全風控，改嘗試 App 端點 (App 端點常會轉發 6 位數信箱驗證碼，操作最友善)
    try:
        device_id = client.generate_app_device_id()
        app_res = await client._app_login(
            account,
            password,
            device_id=device_id,
        )

        # 狀況 A：App 端點直接登入成功
        if isinstance(app_res, AppLoginResult):
            cookie_dict = {}
            for k in ["ltoken_v2", "ltuid_v2", "stoken", "account_id_v2"]:
                val = getattr(app_res, k, None)
                if val:
                    cookie_dict[k] = val
            
            # 若已有 stoken，嘗試換取 ltoken
            if "stoken" in cookie_dict and "ltuid_v2" in cookie_dict:
                try:
                    await client.get_ltoken_by_stoken()
                    ltoken = client.cookies.get("ltoken_v2") or client.cookies.get("ltoken")
                    if ltoken:
                        cookie_dict["ltoken_v2"] = ltoken
                except Exception:
                    pass

            cookie_str = "; ".join([f"{k}={v}" for k, v in cookie_dict.items()])
            return {
                "success": True,
                "status": "SUCCESS",
                "cookie": cookie_str,
                "cookie_dict": cookie_dict,
                "message": "登入成功！已成功換取簽到憑證。"
            }

        # 狀況 B：需要信箱 2FA 驗證碼 (6 位數)
        if isinstance(app_res, ActionTicket):
            # 自動發送驗證碼到使用者信箱
            send_mmt = await client._send_verification_email(app_res)
            if send_mmt:
                # 發送信箱驗證碼時觸發了圖形驗證
                return {
                    "success": False,
                    "error": "GEETEST_REQUIRED",
                    "message": "HoYoLAB 官方對當前連線觸發了圖形滑塊驗證 (GeeTest)。\n建議改用 `/星鐵綁定` 貼上 Cookie，或稍後再試。"
                }

            # 回傳 ActionTicket 給 Node.js 暫存，等待使用者輸入 6 位數驗證碼
            ticket_dump = app_res.model_dump()
            return {
                "success": True,
                "status": "NEED_VERIFY_CODE",
                "device_id": device_id,
                "ticket": ticket_dump,
                "message": "HoYoLAB 已向您的信箱發送 6 位數驗證碼！請點擊「輸入驗證碼」完成綁定。"
            }

        # 狀況 C：觸發圖形驗證 (GeeTest)
        if isinstance(app_res, (SessionMMT, SessionMMTv4)):
            return {
                "success": False,
                "error": "GEETEST_REQUIRED",
                "message": "米哈遊官方對當前伺服器 IP 觸發了圖形滑塊驗證 (GeeTest)。\n💡 **最推薦解決方式**：請在手機或電腦瀏覽器登入 HoYoLAB，使用 `/星鐵綁定` 直接貼上 Cookie（安全且完全不受伺服器 IP 風控限制）！"
            }

    except genshin.errors.AccountLoginFail:
        return {"success": False, "error": "INVALID_PASSWORD", "message": "密碼錯誤，請確認後重新輸入！"}
    except genshin.errors.AccountDoesNotExist:
        return {"success": False, "error": "ACCOUNT_NOT_FOUND", "message": "該 HoYoLAB 帳號不存在，請確認信箱是否正確！"}
    except Exception as e:
        return {"success": False, "error": type(e).__name__, "message": f"代登驗證失敗: {str(e)}"}

    return {
        "success": False,
        "error": "UNKNOWN_ERROR",
        "message": "未能取得 HoYoLAB 憑證，請確認帳號密碼或改用 `/星鐵綁定`。"
    }


async def login_step2_verify(account: str, password: str, code: str, ticket_data: dict, device_id: str):
    """
    第二階段：提交信箱 6 位數驗證碼完成登入
    """
    client = genshin.Client(region=genshin.Region.OVERSEAS)
    try:
        ticket = ActionTicket(**ticket_data)
        await client._verify_email(code.strip(), ticket)

        # 驗證通過後，正式完成登入
        final_res = await client._app_login(
            account,
            password,
            device_id=device_id,
            ticket=ticket,
        )

        if isinstance(final_res, AppLoginResult):
            cookie_dict = {}
            for k in ["ltoken_v2", "ltuid_v2", "stoken", "account_id_v2"]:
                val = getattr(final_res, k, None)
                if val:
                    cookie_dict[k] = val

            # 若已有 stoken，換取 ltoken_v2
            if "stoken" in cookie_dict and "ltuid_v2" in cookie_dict:
                try:
                    await client.get_ltoken_by_stoken()
                    ltoken = client.cookies.get("ltoken_v2") or client.cookies.get("ltoken")
                    if ltoken:
                        cookie_dict["ltoken_v2"] = ltoken
                except Exception:
                    pass

            cookie_str = "; ".join([f"{k}={v}" for k, v in cookie_dict.items()])
            return {
                "success": True,
                "status": "SUCCESS",
                "cookie": cookie_str,
                "cookie_dict": cookie_dict,
                "message": "驗證碼確認成功！已成功綁定 HoYoLAB 簽到憑證。"
            }
        else:
            return {"success": False, "error": "LOGIN_FINALIZE_FAIL", "message": "驗證碼確認後未能成功換取憑證，請稍後再試。"}
    except Exception as e:
        return {"success": False, "error": type(e).__name__, "message": f"驗證碼校驗失敗: {str(e)}"}


def main():
    parser = argparse.ArgumentParser(description="HoYoLAB 帳密自動換取 Cookie 憑證小工具")
    parser.add_argument("--action", type=str, default="login", choices=["login", "verify"], help="動作：login (第一階段帳密登入) 或 verify (第二階段驗證碼確認)")
    parser.add_argument("--account", type=str, required=True, help="HoYoLAB 信箱或帳號")
    parser.add_argument("--password", type=str, required=True, help="HoYoLAB 密碼")
    parser.add_argument("--code", type=str, default="", help="6 位數信箱驗證碼")
    parser.add_argument("--ticket", type=str, default="", help="ActionTicket JSON 字串")
    parser.add_argument("--device_id", type=str, default="", help="Device ID")

    args = parser.parse_args()

    if args.action == "login":
        res = asyncio.run(login_step1(args.account, args.password))
    else:
        ticket_data = json.loads(args.ticket) if args.ticket else {}
        res = asyncio.run(login_step2_verify(args.account, args.password, args.code, ticket_data, args.device_id))

    print("__AUTH_RESULT_START__")
    print(json.dumps(res, ensure_ascii=False))
    print("__AUTH_RESULT_END__")


if __name__ == "__main__":
    main()
