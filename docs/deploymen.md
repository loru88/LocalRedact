# Frontend deployment

This repository publishes the static site in `dist/` to the `localredact`
subfolder of the personal website. Production publication is performed by the
tagged-release workflow after validation succeeds.

## One-time GitHub configuration

Configure these repository variables in `loru88/LocalRedact`:

| Variable | Value |
| --- | --- |
| `FTP_HOST` | `ftp.lorenzoadinolfi.it` |
| `FTP_PORT` | The explicit FTPS port supplied by the hosting provider |
| `FTP_REMOTE_ROOT` | The provider-specific parent web-root directory |

Configure these encrypted repository secrets:

| Secret | Value |
| --- | --- |
| `FTP_USERNAME` | The FTP account username |
| `FTP_PASSWORD` | The FTP account password |

Enter the password directly in the repository secret settings. Do not put it
in source files, workflow logs, committed environment files, or issue text.
The parent web-root value must be confirmed with the hosting provider; do not
guess it from the FTP account home directory.

The workflow must use explicit FTPS with certificate verification enabled. It
must not silently fall back to plain FTP. The destination is resolved as:

```text
${FTP_REMOTE_ROOT}/localredact
```

Only the contents of `dist/` are uploaded. Remote deletion is disabled, so
files outside this destination are not removed.

## Release procedure

Run the checks from the frontend repository root before creating a release:

```sh
npm ci
npm test
npm run build
```

Create and push a version tag after the checks pass. Use the tag format
accepted by the workflow, for example:

```sh
git tag v1.0.0
git push origin v1.0.0
```

The tagged workflow checks out that commit, installs from the committed
`package-lock.json`, runs the tests and build, and uploads `dist/` only if all
validation steps succeed. A failed test or build prevents any FTPS upload.

Inspect the workflow run in the repository’s Actions page. Confirm that the
run uses the intended tag and commit, and that logs do not contain secret
values or the password.

## Post-deployment verification

After a successful upload:

1. Open the public `localredact` URL over HTTPS.
2. Confirm that `index.html` loads without console or network errors.
3. Confirm that JavaScript, CSS, worker, and public asset URLs resolve from the
   `localredact` subfolder.
4. Load the sample document and verify the client-side application responds.
5. Confirm that files outside the `localredact` destination remain unchanged.

## Rollback

To restore an earlier release, push its existing version tag again only if the
workflow supports reruns; otherwise create a new rollback tag pointing to the
earlier commit and push it:

```sh
git tag v1.0.1-rollback v1.0.0
git push origin v1.0.1-rollback
```

Use a new tag name when the original tag already exists. Verify the public site
again after the rollback upload. Because FTP publication is not transactional,
a failed transfer can briefly leave a mixed version; redeploy the intended tag
to restore the complete static site.

## Safety checks

- Keep `dist/`, `node_modules/`, `.env` files, and credentials out of commits.
- Verify the FTPS mode, port, and parent web root before the first production
  release.
- Never enable a mirror or delete operation without confirming that it is
  restricted to `FTP_REMOTE_ROOT/localredact`.
- Review every generated PDF or TXT output in the application; deployment only
  publishes the frontend and does not guarantee complete anonymization.