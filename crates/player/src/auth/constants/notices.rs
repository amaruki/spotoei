use super::html_escape;

pub fn html_notice(title: &str, message: &str) -> String {
    let safe_title = html_escape(title);
    let safe_msg = html_escape(message);
    format!(
        r#"<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Spotoei - Login Already Handled</title>
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
      border: 1px solid #282828;
      border-radius: 12px;
      padding: 40px 48px;
      max-width: 440px;
      box-shadow: 0 16px 32px rgba(0, 0, 0, 0.5);
    }}
    .icon {{
      font-size: 48px;
      color: #1DB954;
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
      margin: 0;
    }}
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">&#10004;</div>
    <h1>{safe_title}</h1>
    <p>{safe_msg}</p>
  </div>
</body>
</html>"#
    )
}

/// Notice page that forwards the browser to the currently active authorization
/// URL. Used when a stale tab cannot be exchanged: instead of dead-ending the
/// user, continue the login that is actually pending. `location.replace` keeps
/// the notice out of history so the back button cannot bounce back into it.
pub fn html_redirect_notice(title: &str, message: &str, url: &str) -> String {
    let safe_title = html_escape(title);
    let safe_msg = html_escape(message);
    let safe_url = html_escape(url);
    let js_url = url
        .replace('\\', "\\\\")
        .replace('\'', "\\'")
        .replace('\n', "")
        .replace("</", "<\\/");
    format!(
        r#"<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="refresh" content="1; url={safe_url}">
  <title>Spotoei - Continuing Login</title>
  <script>window.location.replace('{js_url}');</script>
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
      border: 1px solid #282828;
      border-radius: 12px;
      padding: 40px 48px;
      max-width: 440px;
      box-shadow: 0 16px 32px rgba(0, 0, 0, 0.5);
    }}
    .icon {{
      font-size: 48px;
      color: #1DB954;
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
      margin: 0 0 20px 0;
    }}
    a {{
      color: #1DB954;
      font-weight: 600;
      text-decoration: none;
    }}
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">&#10004;</div>
    <h1>{safe_title}</h1>
    <p>{safe_msg}</p>
    <a href="{safe_url}">Continue with the current login &rarr;</a>
  </div>
</body>
</html>"#
    )
}

/// Notice page with a manual link but no automatic navigation. Used after an
/// auto-forward already bounced back, so the browser cannot loop.
pub fn html_link_notice(title: &str, message: &str, url: &str) -> String {
    let safe_title = html_escape(title);
    let safe_msg = html_escape(message);
    let safe_url = html_escape(url);
    format!(
        r#"<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Spotoei - Continue Login</title>
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
      border: 1px solid #282828;
      border-radius: 12px;
      padding: 40px 48px;
      max-width: 440px;
      box-shadow: 0 16px 32px rgba(0, 0, 0, 0.5);
    }}
    .icon {{
      font-size: 48px;
      color: #1DB954;
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
      margin: 0 0 20px 0;
    }}
    a {{
      color: #1DB954;
      font-weight: 600;
      text-decoration: none;
    }}
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">&#10004;</div>
    <h1>{safe_title}</h1>
    <p>{safe_msg}</p>
    <a href="{safe_url}">Open the current login &rarr;</a>
  </div>
</body>
</html>"#
    )
}
