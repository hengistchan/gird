# Changesets

This directory contains changeset files that track changes for versioning.

## How to use

### 1. Make changes to packages

When you make changes that should be included in the next release:

```bash
pnpm changeset
```

This will prompt you to:
1. Select which packages changed
2. Choose version bump type (major/minor/patch)
3. Write a description of the change

### 2. Version packages

Before releasing, version the packages:

```bash
pnpm changeset:version
```

This will:
- Update package versions
- Update dependencies
- Generate/update CHANGELOGs

### 3. Publish

Publish to npm:

```bash
pnpm changeset:publish
```

## Automated Release (GitHub Actions)

The release workflow automatically:
1. Runs on every push to `main`
2. Creates/updates a "Version Packages" PR
3. Publishes when the Version PR is merged

## Version Types

- **major** (1.0.0 → 2.0.0): Breaking changes
- **minor** (1.0.0 → 1.1.0): New features, backwards compatible
- **patch** (1.0.0 → 1.0.1): Bug fixes, backwards compatible
