//! Rust-only: the derive macros name events exactly like serde, so the JS side can send
//! `{ type, ... }` objects that both decoders (serde and `DeserializeEvent`) accept.

use dunky_core::{DeserializeEvent, Event, EventEnum};
use serde::Deserialize;

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
