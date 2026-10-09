//! TypeScript types for the derives: `#[derive(TsType)]` on data types, and the
//! `TsType` impls `State`, `Event` and `Context` emit. Names follow the serde attributes
//! the value crosses with, so the TS type matches the JS value.

use proc_macro2::TokenStream as TokenStream2;
use quote::quote;
use syn::{
    Attribute, Data, DeriveInput, Expr, ExprLit, Field, Fields, GenericArgument, Ident, Lit,
    PathArguments, Type,
};

use crate::serde_case;

/// The serde attributes that shape a value's JS form.
#[derive(Default)]
pub(crate) struct Serde {
    pub(crate) rename: Option<String>,
    pub(crate) rename_all: Option<String>,
    pub(crate) rename_all_fields: Option<String>,
    pub(crate) tag: Option<String>,
    skip: bool,
    skip_serializing: bool,
    skip_deserializing: bool,
    skip_serializing_if: Option<String>,
    default: bool,
    transparent: bool,
}

pub(crate) fn serde_attrs(attrs: &[Attribute]) -> syn::Result<Serde> {
    let mut out = Serde::default();
    for a in attrs.iter().filter(|a| a.path().is_ident("serde")) {
        a.parse_nested_meta(|meta| {
            let name = meta
                .path
                .get_ident()
                .map(Ident::to_string)
                .unwrap_or_default();
            let value = if meta.input.peek(syn::Token![=]) {
                match meta.value()?.parse::<Expr>()? {
                    Expr::Lit(ExprLit {
                        lit: Lit::Str(s), ..
                    }) => Some(s.value()),
                    _ => None,
                }
            } else if meta.input.peek(syn::token::Paren) {
                if matches!(name.as_str(), "rename" | "rename_all") {
                    return Err(
                        meta.error("TsType: split serialize/deserialize names are not supported")
                    );
                }
                let _content;
                syn::parenthesized!(_content in meta.input);
                None
            } else {
                None
            };
            match name.as_str() {
                "rename" => out.rename = value,
                "rename_all" => out.rename_all = value,
                "rename_all_fields" => out.rename_all_fields = value,
                "tag" => out.tag = value,
                "skip" => out.skip = true,
                "skip_serializing" => out.skip_serializing = true,
                "skip_deserializing" => out.skip_deserializing = true,
                "skip_serializing_if" => out.skip_serializing_if = value,
                "default" => out.default = true,
                "transparent" => out.transparent = true,
                "flatten" | "untagged" | "content" => {
                    return Err(meta.error(format!("TsType: `{name}` is not supported")));
                }
                _ => {}
            }
            Ok(())
        })?;
    }
    Ok(out)
}

/// Which way a value crosses: shown to JS (serialized) or sent from JS (deserialized).
#[derive(Clone, Copy)]
pub(crate) enum Direction {
    ToJs,
    FromJs,
}

/// serde's `rename_all` rules for a (snake_case) field name, like serde applies them.
fn field_case(field: &str, rule: &str) -> Option<String> {
    let pascal = || {
        field
            .split('_')
            .map(|part| {
                let mut chars = part.chars();
                chars
                    .next()
                    .map(|c| c.to_ascii_uppercase().to_string() + chars.as_str())
                    .unwrap_or_default()
            })
            .collect::<String>()
    };
    Some(match rule {
        "lowercase" | "snake_case" => field.to_owned(),
        "UPPERCASE" | "SCREAMING_SNAKE_CASE" => field.to_ascii_uppercase(),
        "PascalCase" => pascal(),
        "camelCase" => {
            let pascal = pascal();
            let mut chars = pascal.chars();
            chars
                .next()
                .map(|c| c.to_ascii_lowercase().to_string() + chars.as_str())
                .unwrap_or_default()
        }
        "kebab-case" => field.replace('_', "-"),
        "SCREAMING-KEBAB-CASE" => field.replace('_', "-").to_ascii_uppercase(),
        _ => return None,
    })
}

fn unknown_rule(span: &impl quote::ToTokens, rule: &str) -> syn::Error {
    syn::Error::new_spanned(span, format!("unknown rename_all rule \"{rule}\""))
}

/// The inner type of `Option<T>`, read from the syntax.
fn option_inner(ty: &Type) -> Option<&Type> {
    let Type::Path(path) = ty else { return None };
    let last = path.path.segments.last()?;
    if last.ident != "Option" {
        return None;
    }
    let PathArguments::AngleBracketed(args) = &last.arguments else {
        return None;
    };
    match args.args.first()? {
        GenericArgument::Type(inner) => Some(inner),
        _ => None,
    }
}

/// The TS members of named fields (`key: type` or `key?: type`), as expressions that
/// build them. `rename_all` is the rule the fields' container applies.
pub(crate) fn members<'a>(
    fields: impl IntoIterator<Item = &'a Field>,
    rename_all: Option<&str>,
    direction: Direction,
) -> syn::Result<Vec<TokenStream2>> {
    let mut out = Vec::new();
    for f in fields {
        let attrs = serde_attrs(&f.attrs)?;
        let skipped = attrs.skip
            || match direction {
                Direction::ToJs => attrs.skip_serializing,
                Direction::FromJs => attrs.skip_deserializing,
            };
        if skipped {
            continue;
        }
        let ident = f.ident.as_ref().expect("named field").to_string();
        let ident = ident.strip_prefix("r#").unwrap_or(&ident);
        let name = match (&attrs.rename, rename_all) {
            (Some(name), _) => name.clone(),
            (None, Some(rule)) => field_case(ident, rule).ok_or_else(|| unknown_rule(f, rule))?,
            (None, None) => ident.to_owned(),
        };
        let none_skipped = attrs.skip_serializing_if.as_deref() == Some("Option::is_none");
        let (optional, ty) = match direction {
            // `None` never crosses as `null` when serde skips it.
            Direction::ToJs => match option_inner(&f.ty) {
                Some(inner) if none_skipped => (true, inner),
                _ => (attrs.skip_serializing_if.is_some(), &f.ty),
            },
            // serde reads a missing `Option` field as `None`.
            Direction::FromJs => (attrs.default || option_inner(&f.ty).is_some(), &f.ty),
        };
        let mark = if optional { "?" } else { "" };
        out.push(quote! {
            ::std::format!(
                "{}{}: {}",
                ::dunky_state_machine::__private::ts_key(#name),
                #mark,
                <#ty as ::dunky_state_machine::TsType>::ts(),
            )
        });
    }
    Ok(out)
}

/// An object type from member expressions.
pub(crate) fn object(members: &[TokenStream2]) -> TokenStream2 {
    quote!(::dunky_state_machine::__private::ts_object(&[#(#members),*]))
}

/// The member that names a variant of a tagged union: `type: 'open'`.
pub(crate) fn tag_member(tag: &str, name: &str) -> TokenStream2 {
    quote! {
        ::std::format!(
            "{}: {}",
            ::dunky_state_machine::__private::ts_key(#tag),
            ::dunky_state_machine::__private::ts_literal(#name),
        )
    }
}

/// Join type expressions into a union (`never` when there are none).
pub(crate) fn union(types: &[TokenStream2]) -> TokenStream2 {
    if types.is_empty() {
        return quote!(::std::string::String::from("never"));
    }
    quote!([#(#types),*].join(" | "))
}

/// `impl TsType` with the body `ts`, bounding every type parameter by `TsType`.
pub(crate) fn impl_ts(input: &DeriveInput, ts: TokenStream2) -> TokenStream2 {
    let name = &input.ident;
    let mut generics = input.generics.clone();
    for param in generics.type_params_mut() {
        param.bounds.push(syn::parse_quote!(::dunky_state_machine::TsType));
    }
    let (impl_g, ty_g, where_g) = generics.split_for_impl();
    quote! {
        impl #impl_g ::dunky_state_machine::TsType for #name #ty_g #where_g {
            fn ts() -> ::std::string::String {
                #ts
            }
        }
    }
}

/// `#[derive(TsType)]`: the value as JS reads it (serialized with serde).
pub(crate) fn expand(input: DeriveInput) -> syn::Result<TokenStream2> {
    let container = serde_attrs(&input.attrs)?;
    let ts = match &input.data {
        Data::Struct(data) => match &data.fields {
            Fields::Named(fields) if !container.transparent => object(&members(
                &fields.named,
                container.rename_all.as_deref(),
                Direction::ToJs,
            )?),
            Fields::Named(fields) if fields.named.len() == 1 => {
                let ty = &fields.named[0].ty;
                quote!(<#ty as ::dunky_state_machine::TsType>::ts())
            }
            Fields::Unnamed(fields) if fields.unnamed.len() == 1 => {
                let ty = &fields.unnamed[0].ty;
                quote!(<#ty as ::dunky_state_machine::TsType>::ts())
            }
            Fields::Unit => quote!(::std::string::String::from("null")),
            _ => {
                return Err(syn::Error::new_spanned(
                    &input.ident,
                    "TsType: use named fields, or one field (a newtype)",
                ));
            }
        },
        Data::Enum(data) => {
            let mut variants = Vec::new();
            for v in &data.variants {
                let attrs = serde_attrs(&v.attrs)?;
                if attrs.skip || attrs.skip_serializing {
                    continue;
                }
                let ident = v.ident.to_string();
                let name = match (&attrs.rename, &container.rename_all) {
                    (Some(name), _) => name.clone(),
                    (None, Some(rule)) => {
                        serde_case(&ident, rule).ok_or_else(|| unknown_rule(&v.ident, rule))?
                    }
                    (None, None) => ident,
                };
                let fields_rule = attrs
                    .rename_all
                    .as_deref()
                    .or(container.rename_all_fields.as_deref());
                variants.push(match (&container.tag, &v.fields) {
                    (None, Fields::Unit) => quote!(::dunky_state_machine::__private::ts_literal(#name)),
                    (Some(tag), Fields::Unit) => object(&[tag_member(tag, &name)]),
                    (Some(tag), Fields::Named(fields)) => {
                        let mut all = vec![tag_member(tag, &name)];
                        all.extend(members(&fields.named, fields_rule, Direction::ToJs)?);
                        object(&all)
                    }
                    _ => {
                        return Err(syn::Error::new_spanned(
                            v,
                            "TsType: an enum with data needs #[serde(tag = \"...\")] and named fields",
                        ));
                    }
                });
            }
            union(&variants)
        }
        Data::Union(_) => {
            return Err(syn::Error::new_spanned(
                &input.ident,
                "TsType: unions are not supported",
            ));
        }
    };
    Ok(impl_ts(&input, ts))
}
