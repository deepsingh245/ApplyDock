// Shared single-column resume layout. Every value from the resume is inserted as a plain
// string (never evaluated as markup), so characters like * # $ @ render literally.
// ApplyDock passes a pre-formatted render model as JSON through sys.inputs.resume; design
// settings (margins, fonts, spacing, colors) arrive in data.style, already validated.

#let contact-line(items, s) = {
  let link-fill = if s.accent_links { rgb(s.accent) } else { rgb("#111111") }
  let parts = items.map(item => if item.url != "" { text(fill: link-fill, link(item.url)[#item.text]) } else { item.text })
  parts.join([#h(0.45em)#s.contact_separator#h(0.45em)])
}

#let entry-block(entry, s) = {
  let head = {
    text(weight: "bold", entry.title)
    if entry.subtitle != "" [ — #entry.subtitle]
    if entry.location != "" [ · #entry.location]
  }
  if s.date_position == "right" {
    block(sticky: true, above: s.entry_gap * 1em, below: 0.45em, width: 100%,
      grid(columns: (1fr, auto), column-gutter: 1em, head, align(right, entry.dates)))
  } else {
    block(sticky: true, above: s.entry_gap * 1em, below: 0.45em, width: 100%, {
      head
      if entry.dates != "" { linebreak(); text(style: "italic", entry.dates) }
    })
  }
  if entry.url != "" {
    let link-fill = if s.accent_links { rgb(s.accent) } else { rgb("#111111") }
    block(above: 0.2em, below: 0.3em, text(fill: link-fill, link(entry.url)[#entry.url_text]))
  }
  if entry.summary != "" {
    block(above: 0.25em, below: 0.3em)[#entry.summary]
  }
  if entry.bullets.len() > 0 {
    list(spacing: s.bullet_gap * 1em, indent: 0.6em, body-indent: 0.5em, ..entry.bullets.map(b => [#b]))
  }
  if entry.keywords != "" {
    block(above: 0.3em, below: 0.2em)[#text(style: "italic")[#entry.keywords]]
  }
}

#let section(sec, s) = {
  heading(level: 1)[#sec.title]
  if sec.kind == "text" {
    block(above: 0.4em)[#sec.text]
  } else if sec.kind == "skills" {
    if s.skills_inline {
      block(above: 0.4em, sec.groups.map(group => {
        if group.name != "" { text(weight: "bold")[#group.name: ] }
        group.keywords
      }).join([#h(0.6em)·#h(0.6em)]))
    } else {
      for group in sec.groups {
        block(above: 0.35em, below: 0.35em)[
          #if group.name != "" [#text(weight: "bold")[#group.name:]#h(0.35em)]#group.keywords
        ]
      }
    }
  } else if sec.kind == "list" {
    list(spacing: s.bullet_gap * 1em, indent: 0.6em, body-indent: 0.5em, ..sec.items.map(item => [#item]))
  } else {
    for entry in sec.entries {
      entry-block(entry, s)
    }
  }
}

#let resume(data) = {
  let s = data.style
  let accent = rgb(s.accent)
  set document(title: data.title, author: data.name, date: none)
  set page(paper: data.paper, margin: (x: s.margin_x * 1mm, y: s.margin_y * 1mm), numbering: none)
  set text(font: (s.font,), size: s.font_size * 1pt, lang: "en", ligatures: false, hyphenate: false, fill: rgb("#111111"))
  set par(justify: false, leading: s.leading * 1em, spacing: s.leading * 1em)
  set smartquote(enabled: false)
  set list(marker: [#s.bullet])
  show heading.where(level: 1): it => block(above: s.section_gap * 1em, below: 0.55em, width: 100%, sticky: true)[
    #set text(size: s.heading_size * 1pt, weight: "bold", fill: if s.accent_headings { accent } else { rgb("#1a1a1a") })
    #if s.heading_upper { upper(it.body) } else { it.body }
    #if s.heading_rule {
      v(-0.65em)
      line(length: 100%, stroke: 0.6pt + (if s.accent_headings { accent } else { rgb("#9a9a9a") }))
    }
  ]

  align(if s.header_align == "left" { left } else if s.header_align == "right" { right } else { center })[
    #text(size: s.name_size * 1pt, weight: "bold", fill: if s.accent_name { accent } else { rgb("#111111") })[#data.name]
    #if data.headline != "" [
      #v(-0.35em)
      #text(size: s.font_size * 1pt + 1pt)[#data.headline]
    ]
    #if data.contact.len() > 0 [
      #v(-0.2em)
      #contact-line(data.contact, s)
    ]
  ]

  for sec in data.sections {
    section(sec, s)
  }
}
