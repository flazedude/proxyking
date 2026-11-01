# Third-party components

This is an initial component and distribution record. It is not a complete inventory of the dependencies in a release artifact. Generate the final inventory from the actual locked frontend, Rust, and engine dependencies before publishing an installer.

## sing-box

- Project: [SagerNet/sing-box](https://github.com/SagerNet/sing-box)
- Baseline reviewed: [v1.14.2](https://github.com/SagerNet/sing-box/releases/tag/v1.14.2), the stable release verified on 2026-09-27
- Upstream copyright: Copyright (C) 2022 by nekohasekai
- License: GNU General Public License, version 3 or later (GPL-3.0-or-later)
- Exact version's license notice: [LICENSE at v1.14.2](https://github.com/SagerNet/sing-box/blob/v1.14.2/LICENSE)
- Corresponding upstream source: [v1.14.2 source tree](https://github.com/SagerNet/sing-box/tree/v1.14.2)
- Full license: [GNU GPL version 3](https://www.gnu.org/licenses/gpl-3.0.en.html)

The upstream notice also restricts derivative use of the sing-box name or implied association without prior consent. ProxyKing is independently named and must not imply SagerNet endorsement.

When distributing an engine binary, include the upstream notices and full license text, preserve applicable dependency notices, and provide complete Corresponding Source for that exact build using a GPL-compliant distribution method. For a downloadable release, GPLv3 section 6(d) describes offering equivalent source access through the same designated place without an additional charge. Preserve build scripts, modifications, dependency information, and any other material required by the definition of Corresponding Source. A link to an unrelated or moving branch is not an exact-build source record. See [GPLv3](https://www.gnu.org/licenses/gpl-3.0.en.html).

Running the engine as a separate process is an architectural choice, not an automatic exemption from license obligations. Whether the whole application is a combined work depends on the integration. Linking an engine library on mobile warrants a fresh review. The [GNU licensing FAQ](https://www.gnu.org/licenses/gpl-faq.en.html#MereAggregation) explains the distinction between aggregation and a combined program. Decide ProxyKing's distribution license and packaging plan before public distribution; this file does not assign a license to ProxyKing itself.

## Application dependencies

The game accelerator uses `yaml` 2.9.1, copyright Eemeli Aro, under the ISC license. Its exact license is included in the pinned npm package at `node_modules/yaml/LICENSE`, the installer's `resources/yaml-LICENSE.txt`, and the [upstream repository](https://github.com/eemeli/yaml/blob/v2.9.1/LICENSE). The separate concept build also copies the license to `dist-accelerator/yaml-LICENSE.txt`.

Bundled brand glyphs come from [Simple Icons](https://github.com/simple-icons/simple-icons) revision `90646e4bf7f3b89df6c37e65baf3e7bc759a517c`, with CC0 text and source recorded in `public/brands/LICENSE.txt` and `SOURCE.txt` and retained in the installed resources. Game names/logos and publisher/store posters identify their respective games and platforms; they do not imply endorsement. Posters are loaded at runtime from store/publisher image hosts rather than included in release assets. Local executable icons are read from the user's installations. Routing candidates in the design review are research only; their code and binaries are not included.

Tauri, React, TypeScript, Vite, Rust crates, UI assets, and their transitive dependencies each retain their own licenses. Record exact versions from the generated lockfiles and include the notices required by the components actually shipped. Development tooling that is not part of the distributed artifact should be identified separately from runtime components.

For every public release, archive the engine artifact identity and checksum, source/build provenance, complete license texts, and a generated dependency inventory alongside the installer. Update this record when the engine or integration changes.
