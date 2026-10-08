//! Derive macros for `dunky-core`. Use them through the re-exports in `dunky_core`.

mod ts;

use proc_macro::TokenStream;
use proc_macro2::{Span, TokenStream as TokenStream2};
use quote::{format_ident, quote};
use syn::{Attribute, Data, DeriveInput, Fields, Ident, LitStr, parse_macro_input};

/// `#[derive(State)]` on a fieldless enum: state names default to the camelCased variant
/// (`HalfOpen` → `"halfOpen"`); override with `#[state(name = "...")]`.
#[proc_macro_derive(State, attributes(state))]
pub fn derive_state(input: TokenStream) -> TokenStream {
    let input = parse_macro_input!(input as DeriveInput);
    expand_state(input)
        .unwrap_or_else(|e| e.to_compile_error())
        .into()
}

/// `#[derive(Event)]` on an enum: generates `<Name>Kind` (one fieldless variant per event)
/// and implements `EventEnum`. Type names default to the camelCased variant; a
/// `#[event(name = "...")]` or `#[serde(rename = "...")]` attribute overrides it.
/// Add `#[event(deserialize)]` on the enum to implement `DeserializeEvent`: the event is
/// rebuilt from its kind + payload fields, without serde's buffered tagged-enum path.
#[proc_macro_derive(Event, attributes(event))]
pub fn derive_event(input: TokenStream) -> TokenStream {
    let input = parse_macro_input!(input as DeriveInput);
    expand_event(input)
        .unwrap_or_else(|e| e.to_compile_error())
        .into()
}

/// `#[derive(Context)]` on a struct with named fields: generates the `<Name>Patch` builder,
/// `<Name>Reader` (tracked reads for computed values), one `Field` const per field
/// (`active_index` → `ACTIVE_INDEX`) and `<Name>::patch()`. Field names for JS are
/// camelCased; override with `#[context(name = "...")]`. Add `#[context(serialize)]` on the
/// struct to implement `SerializeFields` (every field must be `serde::Serialize`).
#[proc_macro_derive(Context, attributes(context))]
pub fn derive_context(input: TokenStream) -> TokenStream {
    let input = parse_macro_input!(input as DeriveInput);
    expand_context(input)
        .unwrap_or_else(|e| e.to_compile_error())
        .into()
}

/// `#[derive(TsType)]` on a data type a machine shows JS (a context field, an event
/// payload, a computed value): its TypeScript type, from the serde attributes it crosses
/// with. Supports structs with named fields, newtypes, unit enums (string unions), and
/// internally tagged enums (`#[serde(tag = "...")]`).
#[proc_macro_derive(TsType)]
pub fn derive_ts(input: TokenStream) -> TokenStream {
    let input = parse_macro_input!(input as DeriveInput);
    ts::expand(input)
        .unwrap_or_else(|e| e.to_compile_error())
        .into()
}

fn camel(ident: &Ident) -> String {
    let s = ident.to_string();
    let s = s.strip_prefix("r#").unwrap_or(&s);
    if s.contains('_') {
        let mut out = String::new();
        let mut upper = false;
        for (i, ch) in s.chars().enumerate() {
            if ch == '_' {
                upper = i > 0;
                continue;
            }
            if upper {
                out.extend(ch.to_uppercase());
                upper = false;
            } else {
                out.push(ch);
            }
        }
        out
    } else {
        let mut chars = s.chars();
        match chars.next() {
            Some(first) => first.to_lowercase().chain(chars).collect(),
            None => String::new(),
        }
    }
}

/// Reads `#[<attr>(name = "...")]` (or `#[serde(rename = "...")]` when `serde_too`).
fn name_attr(attrs: &[Attribute], attr: &str, serde_too: bool) -> syn::Result<Option<String>> {
    let mut found = None;
    for a in attrs {
        let is_own = a.path().is_ident(attr);
        let is_serde = serde_too && a.path().is_ident("serde");
        if !is_own && !is_serde {
            continue;
        }
        let key = if is_own { "name" } else { "rename" };
        a.parse_nested_meta(|meta| {
            if meta.path.is_ident(key) {
                let value: LitStr = meta.value()?.parse()?;
                if is_own || found.is_none() {
                    found = Some(value.value());
                }
            } else if meta.input.peek(syn::Token![=]) {
                // Skip other `key = value` items (e.g. serde's).
                let _: syn::Expr = meta.value()?.parse()?;
            } else if meta.input.peek(syn::token::Paren) {
                let _content;
                syn::parenthesized!(_content in meta.input);
            }
            Ok(())
        })?;
    }
    Ok(found)
}

/// serde's `rename_all` rules, applied to a (PascalCase) variant name exactly like serde does.
pub(crate) fn serde_case(variant: &str, rule: &str) -> Option<String> {
    let snake = || {
        let mut out = String::new();
        for (i, ch) in variant.char_indices() {
            if i > 0 && ch.is_uppercase() {
                out.push('_');
            }
            out.push(ch.to_ascii_lowercase());
        }
        out
    };
    Some(match rule {
        "lowercase" => variant.to_ascii_lowercase(),
        "UPPERCASE" => variant.to_ascii_uppercase(),
        "PascalCase" => variant.to_owned(),
        "camelCase" => {
            let mut chars = variant.chars();
            chars
                .next()
                .map(|c| c.to_ascii_lowercase().to_string() + chars.as_str())
                .unwrap_or_default()
        }
        "snake_case" => snake(),
        "SCREAMING_SNAKE_CASE" => snake().to_ascii_uppercase(),
        "kebab-case" => snake().replace('_', "-"),
        "SCREAMING-KEBAB-CASE" => snake().replace('_', "-").to_ascii_uppercase(),
        _ => return None,
    })
}

/// Reads `#[serde(<key> = "...")]`.
fn serde_str(attrs: &[Attribute], key: &str) -> syn::Result<Option<String>> {
    let mut found = None;
    for a in attrs {
        if !a.path().is_ident("serde") {
            continue;
        }
        a.parse_nested_meta(|meta| {
            if meta.path.is_ident(key) {
                let value: LitStr = meta.value()?.parse()?;
                found = Some(value.value());
            } else if meta.input.peek(syn::Token![=]) {
                let _: syn::Expr = meta.value()?.parse()?;
            } else if meta.input.peek(syn::token::Paren) {
                let _content;
                syn::parenthesized!(_content in meta.input);
            }
            Ok(())
        })?;
    }
    Ok(found)
}

fn has_flag(attrs: &[Attribute], attr: &str, flag: &str) -> syn::Result<bool> {
    let mut on = false;
    for a in attrs {
        if !a.path().is_ident(attr) {
            continue;
        }
        a.parse_nested_meta(|meta| {
            if meta.path.is_ident(flag) {
                on = true;
            } else if meta.input.peek(syn::Token![=]) {
                let _: syn::Expr = meta.value()?.parse()?;
            }
            Ok(())
        })?;
    }
    Ok(on)
}

fn expand_state(input: DeriveInput) -> syn::Result<TokenStream2> {
    let name = &input.ident;
    let Data::Enum(data) = &input.data else {
        return Err(syn::Error::new_spanned(
            &input.ident,
            "#[derive(State)] needs an enum",
        ));
    };
    let mut names = Vec::new();
    let mut variants = Vec::new();
    for v in &data.variants {
        if !matches!(v.fields, Fields::Unit) {
            return Err(syn::Error::new_spanned(
                v,
                "state variants cannot carry data",
            ));
        }
        names.push(name_attr(&v.attrs, "state", false)?.unwrap_or_else(|| camel(&v.ident)));
        variants.push(&v.ident);
    }
    let indices: Vec<usize> = (0..variants.len()).collect();
    let literals: Vec<TokenStream2> = names
        .iter()
        .map(|n| quote!(::dunky_core::__private::ts_literal(#n)))
        .collect();
    let ts_impl = ts::impl_ts(&input, ts::union(&literals));
    let (impl_g, ty_g, where_g) = input.generics.split_for_impl();
    Ok(quote! {
        #ts_impl

        impl #impl_g ::dunky_core::StateEnum for #name #ty_g #where_g {
            const NAMES: &'static [&'static str] = &[#(#names),*];
            fn index(self) -> usize {
                match self { #(#name::#variants => #indices,)* }
            }
            fn from_index(index: usize) -> Self {
                match index {
                    #(#indices => #name::#variants,)*
                    _ => panic!("[machine] no state at index {index}"),
                }
            }
        }
    })
}

fn expand_event(input: DeriveInput) -> syn::Result<TokenStream2> {
    let name = &input.ident;
    let vis = &input.vis;
    let Data::Enum(data) = &input.data else {
        return Err(syn::Error::new_spanned(
            &input.ident,
            "#[derive(Event)] needs an enum",
        ));
    };
    let kind = format_ident!("{}Kind", name);
    let deserialize = has_flag(&input.attrs, "event", "deserialize")?;
    let rename_all_fields = serde_str(&input.attrs, "rename_all_fields")?;
    let rename_all = serde_str(&input.attrs, "rename_all")?;
    let mut names = Vec::new();
    let mut variants = Vec::new();
    let mut patterns = Vec::new();
    let mut builders = Vec::new();
    let mut payload_arms = Vec::new();
    for (index, v) in data.variants.iter().enumerate() {
        let ident = &v.ident;
        payload_arms.push(match &v.fields {
            Fields::Unit => quote!(#index => ::core::result::Result::Ok(#name::#ident),),
            Fields::Named(fields) => {
                let field_idents: Vec<&Ident> =
                    fields.named.iter().map(|f| f.ident.as_ref().expect("named field")).collect();
                let field_tys: Vec<&syn::Type> = fields.named.iter().map(|f| &f.ty).collect();
                let field_attrs: Vec<Vec<&Attribute>> = fields
                    .named
                    .iter()
                    .map(|f| f.attrs.iter().filter(|a| a.path().is_ident("serde")).collect())
                    .collect();
                // The variant's own rename_all wins over the enum's rename_all_fields.
                let rename = serde_str(&v.attrs, "rename_all")?
                    .or_else(|| rename_all_fields.clone())
                    .map(|r| quote!(#[serde(rename_all = #r)]))
                    .unwrap_or_default();
                quote!(#index => {
                    #[derive(::dunky_core::__private::serde::Deserialize)]
                    #[serde(crate = "::dunky_core::__private::serde")]
                    #rename
                    struct __Payload { #( #(#field_attrs)* #field_idents: #field_tys, )* }
                    let p = <__Payload as ::dunky_core::__private::serde::Deserialize>::deserialize(deserializer)?;
                    ::core::result::Result::Ok(#name::#ident { #(#field_idents: p.#field_idents,)* })
                })
            }
            Fields::Unnamed(_) => quote!(#index => ::core::result::Result::Err(
                <__D::Error as ::dunky_core::__private::serde::de::Error>::custom(
                    "tuple event variants carry no field names; use named fields"
                )
            ),),
        });
    }
    for v in &data.variants {
        let ident = &v.ident;
        // Same name serde uses: explicit rename > the enum's rename_all > camelCase.
        let kind_name = match name_attr(&v.attrs, "event", true)? {
            Some(explicit) => explicit,
            None => match &rename_all {
                Some(rule) => serde_case(&ident.to_string(), rule).ok_or_else(|| {
                    syn::Error::new_spanned(ident, format!("unknown rename_all rule \"{rule}\""))
                })?,
                None => camel(ident),
            },
        };
        names.push(kind_name);
        variants.push(ident.clone());
        patterns.push(match &v.fields {
            Fields::Unit => quote!(#name::#ident),
            Fields::Named(_) => quote!(#name::#ident { .. }),
            Fields::Unnamed(_) => quote!(#name::#ident(..)),
        });
        builders.push(match &v.fields {
            Fields::Unit => quote!(::core::option::Option::Some(#name::#ident)),
            _ => quote!(::core::option::Option::None),
        });
    }
    let indices: Vec<usize> = (0..variants.len()).collect();
    let ts_impl = if deserialize {
        let mut types = Vec::new();
        for (v, kind_name) in data.variants.iter().zip(&names) {
            let fields_rule =
                serde_str(&v.attrs, "rename_all")?.or_else(|| rename_all_fields.clone());
            let mut members = vec![ts::tag_member("type", kind_name)];
            match &v.fields {
                Fields::Unit => {}
                Fields::Named(fields) => members.extend(ts::members(
                    &fields.named,
                    fields_rule.as_deref(),
                    ts::Direction::FromJs,
                )?),
                // JS cannot send it: no field names to read.
                Fields::Unnamed(_) => continue,
            }
            types.push(ts::object(&members));
        }
        ts::impl_ts(&input, ts::union(&types))
    } else {
        quote! {}
    };
    let deserialize_impl = if deserialize {
        quote! {
            impl ::dunky_core::DeserializeEvent for #name {
                fn deserialize_payload<'de, __D: ::dunky_core::__private::serde::Deserializer<'de>>(
                    kind: usize,
                    deserializer: __D,
                ) -> ::core::result::Result<Self, __D::Error> {
                    #[allow(unused_variables)]
                    let deserializer = deserializer;
                    match kind {
                        #(#payload_arms)*
                        _ => ::core::result::Result::Err(
                            <__D::Error as ::dunky_core::__private::serde::de::Error>::custom("no such event type")
                        ),
                    }
                }
            }
        }
    } else {
        quote! {}
    };
    Ok(quote! {
        /// The event types of
        #[doc = concat!("[`", stringify!(#name), "`]")]
        /// without their payloads.
        #[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
        #vis enum #kind { #(#variants),* }

        impl ::dunky_core::EventEnum for #name {
            type Kind = #kind;
            const KIND_NAMES: &'static [&'static str] = &[#(#names),*];
            fn kind(&self) -> #kind {
                match self { #(#patterns => #kind::#variants,)* }
            }
            fn kind_index(kind: #kind) -> usize {
                match kind { #(#kind::#variants => #indices,)* }
            }
            fn kind_from_index(index: usize) -> #kind {
                match index {
                    #(#indices => #kind::#variants,)*
                    _ => panic!("[machine] no event type at index {index}"),
                }
            }
            fn from_kind(kind: #kind) -> ::core::option::Option<Self> {
                match kind { #(#kind::#variants => #builders,)* }
            }
        }

        #deserialize_impl

        #ts_impl
    })
}

fn expand_context(input: DeriveInput) -> syn::Result<TokenStream2> {
    let name = &input.ident;
    let vis = &input.vis;
    let Data::Struct(data) = &input.data else {
        return Err(syn::Error::new_spanned(
            &input.ident,
            "#[derive(Context)] needs a struct",
        ));
    };
    let fields: Vec<_> = match &data.fields {
        Fields::Named(f) => f.named.iter().collect(),
        Fields::Unit => Vec::new(),
        Fields::Unnamed(f) => {
            return Err(syn::Error::new_spanned(
                f,
                "#[derive(Context)] needs named fields",
            ));
        }
    };
    if fields.len() > 64 {
        return Err(syn::Error::new_spanned(
            &input.ident,
            "a context supports at most 64 fields",
        ));
    }
    let serialize = has_flag(&input.attrs, "context", "serialize")?;
    let patch = format_ident!("{}Patch", name);
    let reader = format_ident!("{}Reader", name);

    let idents: Vec<&Ident> = fields
        .iter()
        .map(|f| f.ident.as_ref().expect("named field"))
        .collect();
    let tys: Vec<&syn::Type> = fields.iter().map(|f| &f.ty).collect();
    let mut js_names = Vec::new();
    for f in &fields {
        let ident = f.ident.as_ref().expect("named field");
        js_names.push(name_attr(&f.attrs, "context", false)?.unwrap_or_else(|| camel(ident)));
    }
    let consts: Vec<Ident> = idents
        .iter()
        .map(|i| {
            let s = i.to_string();
            Ident::new(
                &s.trim_start_matches("r#").to_uppercase(),
                Span::call_site(),
            )
        })
        .collect();
    let indices: Vec<usize> = (0..idents.len()).collect();
    let bits: Vec<u64> = indices.iter().map(|i| 1u64 << i).collect();

    let ts_impl = if serialize {
        let members: Vec<TokenStream2> = js_names
            .iter()
            .zip(&tys)
            .map(|(js, ty)| {
                quote! {
                    ::std::format!(
                        "{}: {}",
                        ::dunky_core::__private::ts_key(#js),
                        <#ty as ::dunky_core::TsType>::ts(),
                    )
                }
            })
            .collect();
        ts::impl_ts(&input, ts::object(&members))
    } else {
        quote! {}
    };
    let serialize_impl = if serialize {
        quote! {
            impl ::dunky_core::SerializeFields for #name {
                fn serialize_field<__S: ::dunky_core::__private::serde::Serializer>(
                    &self,
                    index: usize,
                    serializer: __S,
                ) -> ::core::result::Result<__S::Ok, __S::Error> {
                    match index {
                        #(#indices => ::dunky_core::__private::serde::Serialize::serialize(&self.#idents, serializer),)*
                        _ => serializer.serialize_unit(),
                    }
                }
            }
        }
    } else {
        quote! {}
    };

    Ok(quote! {
        /// A partial update of
        #[doc = concat!("[`", stringify!(#name), "`]")]
        /// — set only the fields you change.
        #[derive(Default)]
        #[allow(dead_code)]
        #vis struct #patch {
            #(#idents: ::core::option::Option<#tys>,)*
        }

        #[allow(dead_code)]
        impl #patch {
            #(
                pub fn #idents(mut self, value: impl ::core::convert::Into<#tys>) -> Self {
                    self.#idents = ::core::option::Option::Some(value.into());
                    self
                }
            )*
        }

        /// Tracked read access for computed values.
        #[derive(Clone, Copy)]
        #[allow(dead_code)]
        #vis struct #reader<'a> {
            ctx: &'a #name,
            deps: &'a ::core::cell::Cell<u64>,
        }

        #[allow(dead_code)]
        impl<'a> #reader<'a> {
            #(
                pub fn #idents(&self) -> &'a #tys {
                    self.deps.set(self.deps.get() | #bits);
                    &self.ctx.#idents
                }
            )*
        }

        #[allow(dead_code)]
        impl #name {
            #(pub const #consts: ::dunky_core::Field<#name, #tys> =
                ::dunky_core::Field::new(#indices, |c: &#name| &c.#idents);)*

            /// Start a patch: `Self::patch().field(value)`.
            pub fn patch() -> #patch {
                ::core::default::Default::default()
            }
        }

        impl ::dunky_core::Context for #name {
            type Patch = #patch;
            type Reader<'a> = #reader<'a>;
            const FIELDS: &'static [&'static str] = &[#(#js_names),*];
            #[allow(unused_mut, unused_variables)]
            fn apply(&mut self, patch: #patch) -> u64 {
                let mut changed = 0u64;
                #(
                    if let ::core::option::Option::Some(value) = patch.#idents {
                        if self.#idents != value {
                            self.#idents = value;
                            changed |= #bits;
                        }
                    }
                )*
                changed
            }
            fn reader<'a>(&'a self, deps: &'a ::core::cell::Cell<u64>) -> #reader<'a> {
                #reader { ctx: self, deps }
            }
        }

        #serialize_impl

        #ts_impl
    })
}
