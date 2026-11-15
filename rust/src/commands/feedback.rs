use crate::feedback::{config, current_metadata, request_body, send, DESCRIPTION_MAX, TITLE_MAX};
use inquire::Text;
use serde_json::Value;
use std::io::IsTerminal;

pub fn run(title: Option<String>, message: Option<String>) {
    if let Err(e) = send_feedback(title, message) {
        eprintln!("{e}");
        std::process::exit(1);
    }
}

fn send_feedback(title: Option<String>, message: Option<String>) -> anyhow::Result<()> {
    // Fail before prompting if this build can't send at all.
    let cfg = config()?;
    let interactive = std::io::stdin().is_terminal() && std::io::stderr().is_terminal();

    let title = match title {
        Some(t) => t,
        None if interactive => Text::new("Title:")
            .with_help_message("a short summary")
            .with_validator(|s: &str| {
                let n = s.trim().chars().count();
                Ok(if n == 0 {
                    inquire::validator::Validation::Invalid("A title is required.".into())
                } else if n > TITLE_MAX {
                    inquire::validator::Validation::Invalid(format!("At most {TITLE_MAX} characters.").into())
                } else {
                    inquire::validator::Validation::Valid
                })
            })
            .prompt()
            .map_err(|_| anyhow::anyhow!("cancelled"))?,
        None => anyhow::bail!("Provide a title with -t/--title (no terminal to prompt in)."),
    };
    let description = match message {
        Some(m) => m,
        None if interactive => Text::new("Description:")
            .with_help_message("optional — what happened, what you expected; Enter to skip")
            .with_validator(|s: &str| {
                Ok(if s.trim().chars().count() > DESCRIPTION_MAX {
                    inquire::validator::Validation::Invalid(format!("At most {DESCRIPTION_MAX} characters.").into())
                } else {
                    inquire::validator::Validation::Valid
                })
            })
            .prompt()
            .map_err(|_| anyhow::anyhow!("cancelled"))?,
        None => String::new(),
    };

    let body = request_body(&title, &description, current_metadata())?;
    print_summary(&body);
    eprintln!("Sending feedback...");
    let created = send(&cfg, &body)?;
    println!("Feedback sent (#{})", created.number);
    println!("{}", created.url);
    Ok(())
}

fn print_summary(body: &Value) {
    let s = |v: &Value| v.as_str().unwrap_or_default().to_string();
    eprintln!("Title:       {}", s(&body["title"]));
    let description = s(&body["description"]);
    if !description.is_empty() {
        let first = description.lines().next().unwrap_or_default();
        let more = if description.lines().count() > 1 { " …" } else { "" };
        eprintln!("Description: {first}{more}");
    }
    if let Some(m) = body["metadata"].as_object() {
        let parts: Vec<String> = m.iter().map(|(k, v)| format!("{k}={}", v.as_str().unwrap_or_default())).collect();
        eprintln!("Metadata:    {}", parts.join(", "));
    }
}
