// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        // projects are saved as files in a folder the person picks (Documents/Inertia Projects by default)
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        // remembers access to the picked folder across restarts (must come after the fs plugin)
        .plugin(tauri_plugin_persisted_scope::init())
        .invoke_handler(tauri::generate_handler![greet])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
