use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
#[derive(Default)]
pub(crate) enum EmailSenderProvider {
    #[serde(rename = "126")]
    Mail126,
    #[serde(rename = "163")]
    Mail163,
    Qq,
    #[default]
    Custom,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
#[derive(Default)]
pub(crate) enum EmailSenderSecurity {
    #[default]
    SslTls,
    StartTls,
    None,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct EmailSenderSettings {
    #[serde(default)]
    pub(crate) enabled: bool,
    #[serde(default)]
    pub(crate) provider: EmailSenderProvider,
    #[serde(default, rename = "senderEmail")]
    pub(crate) sender_email: String,
    #[serde(default, rename = "senderName")]
    pub(crate) sender_name: String,
    #[serde(default, rename = "smtpHost")]
    pub(crate) smtp_host: String,
    #[serde(default = "default_email_sender_smtp_port", rename = "smtpPort")]
    pub(crate) smtp_port: u16,
    #[serde(default)]
    pub(crate) security: EmailSenderSecurity,
    #[serde(default)]
    pub(crate) username: String,
    #[serde(default, rename = "recipientEmail")]
    pub(crate) recipient_email: String,
}

impl Default for EmailSenderSettings {
    fn default() -> Self {
        Self {
            enabled: false,
            provider: EmailSenderProvider::Custom,
            sender_email: String::new(),
            sender_name: String::new(),
            smtp_host: String::new(),
            smtp_port: default_email_sender_smtp_port(),
            security: EmailSenderSecurity::SslTls,
            username: String::new(),
            recipient_email: String::new(),
        }
    }
}

pub(crate) fn default_email_sender_settings() -> EmailSenderSettings {
    EmailSenderSettings::default()
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
#[derive(Default)]
pub(crate) enum EmailInboundSecurity {
    #[default]
    SslTls,
    StartTls,
    None,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct EmailInboundSettings {
    #[serde(default)]
    pub(crate) enabled: bool,
    #[serde(default)]
    pub(crate) provider: EmailSenderProvider,
    #[serde(default, rename = "imapHost")]
    pub(crate) imap_host: String,
    #[serde(default = "default_email_inbound_imap_port", rename = "imapPort")]
    pub(crate) imap_port: u16,
    #[serde(default)]
    pub(crate) security: EmailInboundSecurity,
    #[serde(default)]
    pub(crate) username: String,
    #[serde(
        default = "default_email_inbound_mailbox_folder",
        rename = "mailboxFolder"
    )]
    pub(crate) mailbox_folder: String,
    #[serde(default, rename = "allowedSenders")]
    pub(crate) allowed_senders: Vec<String>,
    #[serde(
        default = "default_email_inbound_poll_interval_seconds",
        rename = "pollIntervalSeconds"
    )]
    pub(crate) poll_interval_seconds: u64,
    #[serde(
        default = "default_email_inbound_read_only_mode",
        rename = "readOnlyMode"
    )]
    pub(crate) read_only_mode: bool,
    #[serde(
        default = "default_email_inbound_action_window_hours",
        rename = "actionWindowHours"
    )]
    pub(crate) action_window_hours: i64,
    #[serde(default, rename = "debugStorageEnabled")]
    pub(crate) debug_storage_enabled: bool,
}

impl Default for EmailInboundSettings {
    fn default() -> Self {
        Self {
            enabled: false,
            provider: EmailSenderProvider::Custom,
            imap_host: String::new(),
            imap_port: default_email_inbound_imap_port(),
            security: EmailInboundSecurity::SslTls,
            username: String::new(),
            mailbox_folder: default_email_inbound_mailbox_folder(),
            allowed_senders: Vec::new(),
            poll_interval_seconds: default_email_inbound_poll_interval_seconds(),
            read_only_mode: default_email_inbound_read_only_mode(),
            action_window_hours: default_email_inbound_action_window_hours(),
            debug_storage_enabled: false,
        }
    }
}

pub(crate) fn default_email_inbound_settings() -> EmailInboundSettings {
    EmailInboundSettings::default()
}

fn default_email_sender_smtp_port() -> u16 {
    465
}

fn default_email_inbound_imap_port() -> u16 {
    993
}

fn default_email_inbound_mailbox_folder() -> String {
    "INBOX".to_string()
}

fn default_email_inbound_poll_interval_seconds() -> u64 {
    300
}

fn default_email_inbound_read_only_mode() -> bool {
    true
}

fn default_email_inbound_action_window_hours() -> i64 {
    24
}

