# [2.12.0](https://github.com/hvalec427/simon/compare/v2.11.0...v2.12.0) (2026-10-06)


### Features

* pick among multiple Metro targets for logs --rn ([6b36244](https://github.com/hvalec427/simon/commit/6b36244c7410c2469ec7eeb217e089b260ee5de1))

# [2.11.0](https://github.com/hvalec427/simon/compare/v2.10.0...v2.11.0) (2026-10-06)


### Features

* stream React Native console and network via logs --rn ([c8a0885](https://github.com/hvalec427/simon/commit/c8a088501c7f13ccda3ff857f1620ea3576f09be))

# [2.10.0](https://github.com/hvalec427/simon/compare/v2.9.0...v2.10.0) (2026-10-06)


### Features

* stream logs from physical iOS devices and add --app filter ([3fffafd](https://github.com/hvalec427/simon/commit/3fffafdc07cb3ca2dd3f4de13f3ec3d2c18d5a39))

# [2.9.0](https://github.com/hvalec427/simon/compare/v2.8.2...v2.9.0) (2026-10-06)


### Features

* send push to real devices via FCM and APNs ([5d5fade](https://github.com/hvalec427/simon/commit/5d5fade1308887808436b4bf5c1493f2d6b5d699))

## [2.8.2](https://github.com/hvalec427/simon/compare/v2.8.1...v2.8.2) (2026-10-06)


### Bug Fixes

* simplify push real-device message to one line ([e100c69](https://github.com/hvalec427/simon/commit/e100c699886ee969b3f3ebc6116726217e568b75))

## [2.8.1](https://github.com/hvalec427/simon/compare/v2.8.0...v2.8.1) (2026-10-06)


### Bug Fixes

* clear message when push targets a real device or Android ([eb2a602](https://github.com/hvalec427/simon/commit/eb2a6021d5c85c55903fc3e628b048a8d73b169d))

# [2.8.0](https://github.com/hvalec427/simon/compare/v2.7.1...v2.8.0) (2026-10-06)


### Features

* warm-foreground apps on open-link by default, add --restart for cold launch ([c9a7336](https://github.com/hvalec427/simon/commit/c9a7336873a2c2d901199c97ffe8f390c5cad6dd))

## [2.7.1](https://github.com/hvalec427/simon/compare/v2.7.0...v2.7.1) (2026-10-05)


### Bug Fixes

* surface devicectl errors when opening a link on a physical device ([2d1ca8d](https://github.com/hvalec427/simon/commit/2d1ca8d661b9f3f66092079227b2b4ffab4b3ca6))

# [2.7.0](https://github.com/hvalec427/simon/compare/v2.6.1...v2.7.0) (2026-10-05)


### Features

* support physical Android location via a bundled helper app ([702c01d](https://github.com/hvalec427/simon/commit/702c01d3eb12993fad12e54933f7ab785f4c70a1))

## [2.6.1](https://github.com/hvalec427/simon/compare/v2.6.0...v2.6.1) (2026-10-05)


### Bug Fixes

* build releases on macOS so Apple Silicon binaries run ([dea72bb](https://github.com/hvalec427/simon/commit/dea72bbf0be3df419c45e5337dbba6be7ba7bccb))

# [2.6.0](https://github.com/hvalec427/simon/compare/v2.5.0...v2.6.0) (2026-10-05)


### Bug Fixes

* make install/uninstall PATH-aware to avoid stale shadowed binaries ([b5295c0](https://github.com/hvalec427/simon/commit/b5295c02c318716c3067e76d1871313e2404a87c))


### Features

* auto-install go-ios and manage the iOS tunnel for real-device location ([0608b93](https://github.com/hvalec427/simon/commit/0608b933c8c4ae813b08e80205c917dacd5de070))
* stop the iOS tunnel after location --reset ([efed383](https://github.com/hvalec427/simon/commit/efed38325860eae322c26830d1d1393a01007b14))
* support physical iOS location via go-ios (experimental) ([f48e9af](https://github.com/hvalec427/simon/commit/f48e9afd29297d5f746422ca7c7355a091432c69))

# [2.5.0](https://github.com/hvalec427/simon/compare/v2.4.1...v2.5.0) (2026-10-05)


### Features

* add location command to set simulated GPS ([0584af1](https://github.com/hvalec427/simon/commit/0584af12457f263ce393b39c5824d0fd3f5a387d))

## [2.4.1](https://github.com/hvalec427/simon/compare/v2.4.0...v2.4.1) (2026-10-05)


### Bug Fixes

* only show push template hint in an interactive terminal ([a1a74c1](https://github.com/hvalec427/simon/commit/a1a74c19a4c729086f51952b39e910d59269e2bb))

# [2.4.0](https://github.com/hvalec427/simon/compare/v2.3.0...v2.4.0) (2026-10-05)


### Features

* add --template flag to push for a copy-paste payload ([129ffb9](https://github.com/hvalec427/simon/commit/129ffb9c7eeba4969b93380974ea148e00f5f04e))

# [2.3.0](https://github.com/hvalec427/simon/compare/v2.2.0...v2.3.0) (2026-10-05)


### Features

* add doctor and push commands ([765fe46](https://github.com/hvalec427/simon/commit/765fe462c1cace64d36572156279a591a7e24fc9))

# [2.2.0](https://github.com/hvalec427/simon/compare/v2.1.0...v2.2.0) (2026-10-05)


### Features

* unify device selection across commands ([f39b388](https://github.com/hvalec427/simon/commit/f39b3881156064ac4774be0ca328e78d457e520c))

# [2.1.0](https://github.com/hvalec427/simon/compare/v2.0.1...v2.1.0) (2026-10-05)


### Features

* add check-update and update commands for self-updating ([51bd0c3](https://github.com/hvalec427/simon/commit/51bd0c35e1a83a7330e5dfcdfe378eb9e921d2f3))

## [2.0.1](https://github.com/hvalec427/simon/compare/v2.0.0...v2.0.1) (2026-10-05)


### Bug Fixes

* route physical iOS deeplinks via Safari instead of prompting ([ab92c32](https://github.com/hvalec427/simon/commit/ab92c32ec4fc5d862c329106443cba5a5f43c226))

# [2.0.0](https://github.com/hvalec427/simon/compare/v1.6.0...v2.0.0) (2026-10-05)


* feat!: open deep links on physical iOS via devicectl ([426824f](https://github.com/hvalec427/simon/commit/426824fbc8b7ca44a58367e980c4a149b877f520))


### BREAKING CHANGES

* removed the record, screenshot, and prefer commands.
