//! Rust-only: the derive macros name events exactly like serde, so the JS side can send
//! `{ type, ... }` objects that both decoders (serde and `DeserializeEvent`) accept.

use dunky_state_machine::{Context, DeserializeEvent, Event, EventEnum, State, TsType};
use serde::{Deserialize, Serialize};

#[derive(Event, Clone, Debug, PartialEq, Deserialize)]
#[event(deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum Picker {
    QuerySet {
        query: String,
    },
    #[serde(rename_all = "camelCase")]
    ItemPick {
        item_id: u32,
    },
    #[serde(rename = "picker.close")]
    Close,
}

#[test]
fn kind_names_follow_serde_renames() {
    assert_eq!(
        Picker::KIND_NAMES,
        ["query_set", "item_pick", "picker.close"]
    );
    let parsed: Picker =
        serde_json::from_value(serde_json::json!({ "type": "query_set", "query": "a" })).unwrap();
    assert_eq!(parsed, Picker::QuerySet { query: "a".into() });
}

#[test]
fn payload_decoding_follows_the_variant_field_renames() {
    let kind = Picker::kind_index(PickerKind::ItemPick);
    let event = Picker::deserialize_payload(
        kind,
        serde_json::json!({ "type": "item_pick", "itemId": 3 }),
    );
    assert_eq!(event.unwrap(), Picker::ItemPick { item_id: 3 });
}

// Only their TS types are read.
#[allow(dead_code)]
#[derive(TsType, Serialize, Clone, PartialEq, Debug)]
struct Item {
    id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    hint: Option<String>,
    note: Option<String>,
}

#[allow(dead_code)]
#[derive(TsType, Serialize, Clone, Copy, PartialEq, Debug)]
#[serde(rename_all = "lowercase")]
enum Direction {
    Up,
    Down,
}

#[derive(State, Clone, Copy, PartialEq, Eq, Debug)]
enum Mode {
    Idle,
    HalfOpen,
}

#[derive(Context, Clone, PartialEq, Debug)]
#[context(serialize)]
struct Ctx {
    items: Vec<Item>,
    active_index: u32,
    direction: Option<Direction>,
}

#[test]
fn ts_types_follow_the_js_names_and_values() {
    assert_eq!(Mode::ts(), "'idle' | 'halfOpen'");
    assert_eq!(
        Picker::ts(),
        "{ type: 'query_set'; query: string } | { type: 'item_pick'; itemId: number } \
         | { type: 'picker.close' }"
    );
    assert_eq!(
        Ctx::ts(),
        "{ items: Array<{ id: string; hint?: string; note: string | null }>; \
         activeIndex: number; direction: 'up' | 'down' | null }"
    );
}
