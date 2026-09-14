use super::html_escape;

pub const HTML_SUCCESS: &str = r#"<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Spotoei - Authenticated Successfully</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      background-color: #121212;
      color: #FFFFFF;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      height: 100vh;
      margin: 0;
      text-align: center;
    }
    .card {
      background: #181818;
      border: 1px solid #282828;
      border-radius: 12px;
      padding: 40px 48px;
      max-width: 440px;
      box-shadow: 0 16px 32px rgba(0, 0, 0, 0.5);
    }
    .icon {
      font-size: 48px;
      color: #1DB954;
      margin-bottom: 16px;
    }
    h1 {
      font-size: 22px;
      font-weight: 700;
      margin: 0 0 12px 0;
      letter-spacing: -0.5px;
    }
    p {
      color: #A7A7A7;
      font-size: 14px;
      line-height: 1.5;
      margin: 0 0 24px 0;
    }
    .badge {
      display: inline-block;
      background: rgba(29, 185, 84, 0.15);
      color: #1DB954;
      font-weight: 600;
      font-size: 12px;
      padding: 6px 14px;
      border-radius: 9999px;
      letter-spacing: 0.5px;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">&#10004;</div>
    <h1>Authenticated with Spotify</h1>
    <p>Spotoei has securely linked to your account. You can now close this tab and return to the terminal.</p>
    <div class="badge">READY TO PLAY</div>
  </div>
</body>
</html>"#;

pub fn html_error(title: &str, message: &str) -> String {
    let safe_title = html_escape(title);
    let safe_msg = html_escape(message);
    format!(
        r#"<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Spotoei - Authentication Error</title>
  <style>
    body {{
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      background-color: #121212;
      color: #FFFFFF;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      height: 100vh;
      margin: 0;
      text-align: center;
    }}
    .card {{
      background: #181818;
      border: 1px solid #E22134;
      border-radius: 12px;
      padding: 40px 48px;
      max-width: 440px;
      box-shadow: 0 16px 32px rgba(0, 0, 0, 0.5);
    }}
    .icon {{
      font-size: 48px;
      color: #E22134;
      margin-bottom: 16px;
    }}
    h1 {{
      font-size: 22px;
      font-weight: 700;
      margin: 0 0 12px 0;
      letter-spacing: -0.5px;
    }}
    p {{
      color: #A7A7A7;
      font-size: 14px;
      line-height: 1.5;
      margin: 0 0 24px 0;
    }}
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">&#9888;</div>
    <h1>{safe_title}</h1>
    <p>{safe_msg}</p>
  </div>
</body>
</html>"#
    )
}
