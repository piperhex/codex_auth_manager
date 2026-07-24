use std::{
    io::ErrorKind,
    net::TcpStream,
    thread,
    time::{Duration, Instant},
};

use serde::Deserialize;
use serde_json::json;
use tauri::Runtime;
use tungstenite::{connect, stream::MaybeTlsStream, Error as WebSocketError, Message, WebSocket};

use crate::cloud::RemoteControlConfig;

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "kebab-case")]
enum ServerMessage {
    Authenticated {
        #[serde(rename = "deviceId")]
        _device_id: String,
    },
    SwitchAccount {
        #[serde(rename = "commandId")]
        command_id: String,
        #[serde(rename = "accountId")]
        account_id: String,
    },
}

pub(crate) fn start<R: Runtime>(app: tauri::AppHandle<R>) {
    thread::spawn(move || loop {
        match crate::cloud::remote_control_config(&app) {
            Ok(Some(config)) => {
                if let Err(error) = run_connection(&app, config) {
                    eprintln!("remote account control disconnected: {error}");
                }
            }
            Ok(None) => {}
            Err(error) => eprintln!("remote account control is unavailable: {error}"),
        }
        thread::sleep(Duration::from_secs(3));
    });
}

fn run_connection<R: Runtime>(
    app: &tauri::AppHandle<R>,
    config: RemoteControlConfig,
) -> Result<(), String> {
    let (mut socket, _) = connect(config.websocket_url.as_str())
        .map_err(|error| format!("WebSocket connection failed: {error}"))?;
    set_read_timeout(socket.get_mut(), Some(Duration::from_secs(2)))?;
    socket
        .send(Message::Text(
            json!({
                "type": "authenticate",
                "accessToken": config.access_token,
                "deviceId": config.device_id,
                "name": config.device_name,
                "platform": config.platform,
                "appVersion": config.app_version,
                "activeAccountId": config.active_account_id,
            })
            .to_string()
            .into(),
        ))
        .map_err(|error| format!("Could not authenticate WebSocket: {error}"))?;

    let mut last_ping = Instant::now();
    loop {
        match socket.read() {
            Ok(Message::Text(text)) => {
                let message = serde_json::from_str::<ServerMessage>(&text)
                    .map_err(|error| format!("Invalid remote control message: {error}"))?;
                if let ServerMessage::SwitchAccount {
                    command_id,
                    account_id,
                } = message
                {
                    handle_switch(app, &mut socket, command_id, account_id)?;
                }
            }
            Ok(Message::Ping(payload)) => {
                socket
                    .send(Message::Pong(payload))
                    .map_err(|error| format!("Could not answer WebSocket ping: {error}"))?;
            }
            Ok(Message::Close(_)) => return Ok(()),
            Ok(_) => {}
            Err(WebSocketError::Io(error))
                if matches!(error.kind(), ErrorKind::WouldBlock | ErrorKind::TimedOut) => {}
            Err(error) => return Err(error.to_string()),
        }

        if last_ping.elapsed() >= Duration::from_secs(20) {
            socket
                .send(Message::Ping(Vec::new().into()))
                .map_err(|error| format!("Could not send WebSocket ping: {error}"))?;
            last_ping = Instant::now();
        }

        let next = crate::cloud::remote_control_config(app)?;
        if next.as_ref().is_none_or(|next| {
            next.websocket_url != config.websocket_url || next.access_token != config.access_token
        }) {
            let _ = socket.close(None);
            return Ok(());
        }
    }
}

fn handle_switch<R: Runtime>(
    app: &tauri::AppHandle<R>,
    socket: &mut WebSocket<MaybeTlsStream<TcpStream>>,
    command_id: String,
    account_id: String,
) -> Result<(), String> {
    let result =
        crate::commands::switch_account_and_restart_chatgpt_blocking(app.clone(), account_id);
    let response = match result {
        Ok(()) => json!({
            "type": "switch-result",
            "commandId": command_id,
            "success": true,
        }),
        Err(error) => json!({
            "type": "switch-result",
            "commandId": command_id,
            "success": false,
            "error": error,
        }),
    };
    socket
        .send(Message::Text(response.to_string().into()))
        .map_err(|error| format!("Could not send account switch result: {error}"))
}

fn set_read_timeout(
    stream: &mut MaybeTlsStream<TcpStream>,
    timeout: Option<Duration>,
) -> Result<(), String> {
    match stream {
        MaybeTlsStream::Plain(stream) => stream.set_read_timeout(timeout),
        MaybeTlsStream::Rustls(stream) => stream.sock.set_read_timeout(timeout),
        _ => Ok(()),
    }
    .map_err(|error| format!("Could not configure WebSocket timeout: {error}"))
}
