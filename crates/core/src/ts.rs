//! TypeScript types of the values a machine shows JS, so a binding can generate a Rust
//! machine's TS types from its Rust ones. The mapping follows how `dunky-state-machine-wasm` moves
//! values through serde: `None` is `null`, sequences are arrays, maps are `Map`s, and
//! every number is a `number`.

use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet, VecDeque};
use std::rc::Rc;
use std::sync::Arc;

/// The TypeScript type of a value as JS sees it. `#[derive(TsType)]` implements it for
/// your own data types; `#[derive(State, Event, Context)]` implement it for the machine's.
pub trait TsType {
    /// The type, written inline: `string`, `{ id: string; hint?: string }`, `number[]`.
    fn ts() -> String;
}

macro_rules! literal {
    ($ts:literal: $($ty:ty),*) => {
        $(impl TsType for $ty {
            fn ts() -> String {
                $ts.into()
            }
        })*
    };
}

literal!("number": u8, u16, u32, u64, u128, usize, i8, i16, i32, i64, i128, isize, f32, f64);
literal!("string": String, str, char);
literal!("boolean": bool);
literal!("null": ());

macro_rules! same_as_inner {
    ($($ty:ident),*) => {
        $(impl<T: TsType + ?Sized> TsType for $ty<T> {
            fn ts() -> String {
                T::ts()
            }
        })*
    };
}

same_as_inner!(Box, Rc, Arc);

impl<T: TsType + ?Sized> TsType for &T {
    fn ts() -> String {
        T::ts()
    }
}

impl<T: TsType> TsType for Option<T> {
    fn ts() -> String {
        format!("{} | null", T::ts())
    }
}

macro_rules! sequence {
    ($($ty:ident),*) => {
        $(impl<T: TsType> TsType for $ty<T> {
            fn ts() -> String {
                array(&T::ts())
            }
        })*
    };
}

sequence!(Vec, VecDeque, HashSet, BTreeSet);

impl<T: TsType> TsType for [T] {
    fn ts() -> String {
        array(&T::ts())
    }
}

impl<T: TsType, const N: usize> TsType for [T; N] {
    fn ts() -> String {
        array(&T::ts())
    }
}

impl<K: TsType, V: TsType, S> TsType for HashMap<K, V, S> {
    fn ts() -> String {
        format!("Map<{}, {}>", K::ts(), V::ts())
    }
}

impl<K: TsType, V: TsType> TsType for BTreeMap<K, V> {
    fn ts() -> String {
        format!("Map<{}, {}>", K::ts(), V::ts())
    }
}

macro_rules! tuple {
    ($($name:ident),+) => {
        impl<$($name: TsType),+> TsType for ($($name,)+) {
            fn ts() -> String {
                let items: &[String] = &[$($name::ts()),+];
                format!("[{}]", items.join(", "))
            }
        }
    };
}

tuple!(A);
tuple!(A, B);
tuple!(A, B, C);
tuple!(A, B, C, D);

/// `T[]`, or `Array<T>` when `T` is a union or an object.
fn array(item: &str) -> String {
    if item.contains(' ') {
        format!("Array<{item}>")
    } else {
        format!("{item}[]")
    }
}

/// An object key: as is when it is an identifier, else quoted.
#[doc(hidden)]
pub fn key(name: &str) -> String {
    let mut chars = name.chars();
    let identifier = chars
        .next()
        .is_some_and(|c| c.is_ascii_alphabetic() || c == '_' || c == '$')
        && chars.all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '$');
    if identifier {
        name.to_owned()
    } else {
        literal(name)
    }
}

/// A string literal type: `'name'`.
#[doc(hidden)]
pub fn literal(value: &str) -> String {
    format!("'{}'", value.replace('\\', "\\\\").replace('\'', "\\'"))
}

/// An object type from its members (`key: type` or `key?: type`).
#[doc(hidden)]
pub fn object(members: &[String]) -> String {
    if members.is_empty() {
        "{}".into()
    } else {
        format!("{{ {} }}", members.join("; "))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_values_the_way_they_reach_js() {
        assert_eq!(<Option<String>>::ts(), "string | null");
        assert_eq!(<Vec<u32>>::ts(), "number[]");
        assert_eq!(<Vec<Option<bool>>>::ts(), "Array<boolean | null>");
        assert_eq!(<HashMap<String, i64>>::ts(), "Map<string, number>");
        assert_eq!(<(u8, String)>::ts(), "[number, string]");
    }

    #[test]
    fn quotes_keys_and_literals_only_when_needed() {
        assert_eq!(key("activeId"), "activeId");
        assert_eq!(key("query.set"), "'query.set'");
        assert_eq!(literal("it's"), "'it\\'s'");
        assert_eq!(object(&[]), "{}");
    }
}
