export interface SigninCredentials {
  email: string
  fbPass: string
  emailPass?: string
  dob?: string
  backupCode?: string
}

export function buildSigninPrompt(creds: SigninCredentials): string {
  return `Log into Facebook with these credentials on a fresh browser profile (no cookies, residential US proxy).

CREDENTIALS:
- Email: ${creds.email}
- Password: ${creds.fbPass}
- Date of birth: ${creds.dob || '(not provided)'}
- 2FA backup codes (use the FIRST one if asked): ${creds.backupCode || '(none)'}
- Email account password (only if FB sends a code to the email): ${creds.emailPass || '(none)'}

STEPS:
1. Navigate to https://www.facebook.com/login
2. Type the email into the email field, password into the password field, click "Log in".
3. If FB asks for a 6-digit code from an authenticator app:
   a. The "2FA backup codes" string ("GE5K XSGJ GPTI SPUC HWYN JWDI 5YVT QXQE") is the TOTP SECRET SEED — NOT a one-time code. Do NOT paste it directly into FB; FB will reject it.
   b. If FB shows "Open your authentication app on your device" with no input field, click "Try another way" (or "Need another way to authenticate?", "Use a different method"). On the next screen, choose the option that says "Authentication app" / "Use a code from your authentication app" / "Enter a code" — this gives you a 6-digit input field.
   c. Open a NEW TAB to https://2fa.live
   d. Paste the entire backup code string (with spaces, e.g. "GE5K XSGJ GPTI SPUC HWYN JWDI 5YVT QXQE") into the FIRST input box on the 2fa.live page.
   e. Click Submit. A 6-digit TOTP code appears in the SECOND box on the right side of the page.
   f. Copy that 6-digit code, switch back to the FB tab, paste it into the 2FA input, click Continue / Submit.
   g. TOTP codes expire every 30 seconds. If FB rejects the code, return to the 2fa.live tab, click Submit again to refresh, copy the new 6-digit code, and retry on FB.
4. If FB sends a confirmation code to the email and shows a "Check your email" screen:
   a. Open a new tab to https://outlook.live.com
   b. Sign in with the email + email password from above
   c. Find the most recent message from Facebook, copy the 6-8 digit code
   d. Switch back to the Facebook tab, paste the code, click Continue
5. CAPTCHA — DO NOT TOUCH IT. A separate background system (puppeteer + Claude vision over CDP) is watching this exact browser session and WILL solve any image-grid CAPTCHA that appears, including clicking the tiles and pressing Verify/Next. You (the agent) have ZERO ability to help. Cross-origin iframe clicks DO NOT work for you. JavaScript injection DOES NOT work. Trying anything just races the solver and breaks it.
   a. Checkbox: if you see an "I'm not a robot" / reCAPTCHA checkbox (NOT yet a tile grid), click it once to summon the grid, then STOP.
   b. Once an image-grid puzzle is on screen ("Select all images with X" / "Select all squares with X"): DO NOT click any tile. DO NOT click Verify, Next, Skip, refresh, audio, or info. DO NOT use querySelector, contentDocument, or any JS injection. DO NOT take action of any kind on the puzzle.
   c. WAIT. Use the wait action (or sleep, or equivalent) to pause for 30 seconds. Do not screenshot-and-move-on; actually wait the full 30 seconds.
   d. After waiting 30s, take ONE screenshot and check:
      - If the puzzle is gone (you see the FB feed, "Save your login info?", or any non-CAPTCHA page) → continue to step 6.
      - If the SAME puzzle is still on screen → the solver is still working. Wait another 30s. Repeat.
      - If a NEW puzzle appeared with a DIFFERENT target word → solver finished the last one. Wait another 30s.
      - If FB shows "Verification expired, please try again" → DO NOT click the button. Just wait another 30s; FB or the solver will refresh.
   e. Repeat the wait/screenshot loop up to 10 times (5 minutes total). Most flows finish in 1-3 cycles.
   f. ONLY if 10 full waits pass and the same puzzle is still blocking: output exactly LOGIN_FAILED CAPTCHA_UNSOLVABLE.
   g. If you find yourself reaching for a click on the puzzle, JS injection, or anything other than wait+screenshot — STOP. That's the wrong instinct here. Just wait.
6. If FB shows "Save your login info?" or "Trust this browser?", always click YES / Trust / Continue.
7. Once you reach the main feed (URL contains facebook.com/ with a feed/home view):
   a. Wait 10 seconds doing nothing — this lets Facebook finish writing the long-lived authentication cookies (xs, c_user) to the browser profile.
   b. Navigate to https://www.facebook.com one more time. Confirm you land on the feed (NOT a login page). This forces Facebook to refresh the persistent session cookie.
   c. Wait another 5 seconds.
   d. Output exactly: LOGIN_OK
8. If login outright fails (wrong password message, account disabled, account locked), output exactly on its own line: LOGIN_FAILED followed by a one-line reason.

RULES:
- Do NOT use CDP, JavaScript injection, or DOM manipulation. Click and type only.
- Do NOT navigate to facebook.com/gaming, marketplace, or anywhere unrelated. Stay on the login flow.
- Do NOT log out.
- STOP immediately after outputting LOGIN_OK or LOGIN_FAILED.`
}
