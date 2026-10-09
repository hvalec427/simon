use crate::devices::get_all_running;

pub fn run() {
    let devices = get_all_running(None);
    if devices.is_empty() {
        println!("Nothing running.");
        return;
    }
    println!("Running:");
    for d in devices {
        println!("  {}", d.label());
    }
}
