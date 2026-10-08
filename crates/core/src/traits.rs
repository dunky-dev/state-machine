use core::cell::Cell;
use core::fmt::Debug;

/// A machine's finite set of states — a fieldless enum. Derive it with `#[derive(State)]`.
pub trait StateEnum: Copy + Eq + Debug + 'static {
    /// Names in variant order. These are the names the JS side sees.
    const NAMES: &'static [&'static str];
    fn index(self) -> usize;
    fn from_index(index: usize) -> Self;
    fn name(self) -> &'static str {
        Self::NAMES[self.index()]
    }
}

/// A machine's events. Derive it with `#[derive(Event)]`, which also generates the
/// fieldless `<Name>Kind` enum that transitions are keyed by.
pub trait EventEnum: Clone + Debug + 'static {
    /// One variant per event type, without payload.
    type Kind: Copy + Eq + Debug + 'static;
    /// Event type names in variant order (`"query.set"` …). JS sends `{ type: <name> }`.
    const KIND_NAMES: &'static [&'static str];
    fn kind(&self) -> Self::Kind;
    fn kind_index(kind: Self::Kind) -> usize;
    fn kind_from_index(index: usize) -> Self::Kind;
    /// Build a payload-less event from its kind. `None` for variants that carry data.
    fn from_kind(kind: Self::Kind) -> Option<Self>;
    fn type_name(&self) -> &'static str {
        Self::KIND_NAMES[Self::kind_index(self.kind())]
    }
}

/// The machine context: one struct, patched in place. Derive it with `#[derive(Context)]`,
/// which generates the `<Name>Patch` builder, the field constants, and the tracked reader.
pub trait Context: Clone + 'static {
    /// A partial update: every field optional (TS `Partial<Context>`).
    type Patch: Default;
    /// Read access that records which fields a computed value reads.
    type Reader<'a>: Copy
    where
        Self: 'a;
    /// Field names in declaration order, camelCased for JS.
    const FIELDS: &'static [&'static str];
    /// Shallow-merge `patch`; return the bit mask of the fields that actually changed.
    fn apply(&mut self, patch: Self::Patch) -> u64;
    fn reader<'a>(&'a self, deps: &'a Cell<u64>) -> Self::Reader<'a>;
}

/// Per-field serialization, for bindings that mirror context fields into another runtime.
/// Opt in with `#[context(serialize)]`.
#[cfg(feature = "serde")]
pub trait SerializeFields: Context {
    fn serialize_field<S: serde::Serializer>(
        &self,
        index: usize,
        serializer: S,
    ) -> Result<S::Ok, S::Error>;
}

/// Rebuild an event from its kind index and its payload fields — the fast path for
/// bindings, which know the kind already. Opt in with `#[event(deserialize)]`.
#[cfg(feature = "serde")]
pub trait DeserializeEvent: EventEnum {
    fn deserialize_payload<'de, D: serde::Deserializer<'de>>(
        kind: usize,
        deserializer: D,
    ) -> Result<Self, D::Error>;
}

/// The unit context, for machines that keep no data.
impl Context for () {
    type Patch = ();
    type Reader<'a> = ();
    const FIELDS: &'static [&'static str] = &[];
    fn apply(&mut self, _patch: ()) -> u64 {
        0
    }
    fn reader<'a>(&'a self, _deps: &'a Cell<u64>) {}
}

#[cfg(feature = "serde")]
impl SerializeFields for () {
    fn serialize_field<S: serde::Serializer>(
        &self,
        _index: usize,
        serializer: S,
    ) -> Result<S::Ok, S::Error> {
        serializer.serialize_unit()
    }
}

/// A typed handle to one context field of type `V` (generated as `Context::FIELD_NAME`
/// consts): its index in the change mask, and how to read it.
pub struct Field<C, V> {
    index: usize,
    get: fn(&C) -> &V,
}

impl<C, V> Field<C, V> {
    #[doc(hidden)]
    pub const fn new(index: usize, get: fn(&C) -> &V) -> Self {
        Self { index, get }
    }
    pub const fn index(self) -> usize {
        self.index
    }
    pub const fn bit(self) -> u64 {
        1 << self.index
    }
    /// The field's value in `context`.
    pub fn get(self, context: &C) -> &V {
        (self.get)(context)
    }
}

impl<C, V> Clone for Field<C, V> {
    fn clone(&self) -> Self {
        *self
    }
}
impl<C, V> Copy for Field<C, V> {}
impl<C, V> Debug for Field<C, V> {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        write!(f, "Field({})", self.index)
    }
}

/// The type bundle of one machine — the Rust counterpart of the TS generics
/// `<State, Context, Event>`. Implement it on a marker struct:
///
/// ```ignore
/// pub struct Palette;
/// impl Types for Palette {
///     type State = PaletteState;
///     type Event = PaletteEvent;
///     type Context = PaletteCtx;
/// }
/// ```
pub trait Types: 'static {
    type State: StateEnum;
    type Event: EventEnum;
    type Context: Context;
}
