# Vast.ai FLUX.2 provisioning utility

`provision-vast-flux2.sh` creates a Vast.ai RTX 5090 instance, installs a FLUX.2
Klein API, waits for the model to load, and returns the three URLs expected by
Samsar's custom text-to-image adapter.

Before reporting success it submits a small authenticated 512px generation,
polls it to completion, and validates the downloaded PNG. This both verifies the
full API contract and warms the model for the demo. Use `--skip-smoke-test` only
when intentionally troubleshooting setup.

The provisioner retries transient Vast API, package-manager, pip, and download
failures. If remote setup still fails, it prints bounded server/tunnel diagnostics
and keeps the instance ID visible so the machine can be inspected or destroyed.

## Credentials

Keep the Vast key out of chat, shell history, and source control. Either export it
in the shell:

```bash
export VAST_API_KEY='your-vast-api-key'
```

or put it in the reusable local file below:

```bash
mkdir -p ~/.config/samsar
chmod 700 ~/.config/samsar
touch ~/.config/samsar/vast.env
chmod 600 ~/.config/samsar/vast.env
```

Then edit `~/.config/samsar/vast.env` and add:

```dotenv
VAST_API_KEY=your-vast-api-key
# HF_TOKEN=optional-hugging-face-token
```

The parser reads `KEY=value` entries without executing the file. The official
Vast key file at `~/.config/vastai/vast_api_key` is also supported. Before
provisioning, add your local public SSH key to the Vast account's SSH Keys page.

## Provision

Inspect the non-billable plan first:

```bash
./provision-vast-flux2.sh --plan
```

Once the local credential file is ready, run the non-billable live preflight. It
validates the API key, positive account credit, account SSH key, Hugging Face
model access, and matching Vast offers:

```bash
./provision-vast-flux2.sh --check
```

Provision the default `black-forest-labs/FLUX.2-klein-4B` configuration:

```bash
./provision-vast-flux2.sh
```

To provision and immediately save the model for the local standalone Samsar
administrator, including making it the Agent image default:

```bash
./provision-vast-flux2.sh --configure-samsar
```

For an API that is already provisioned, configure the latest saved adapter with:

```bash
./configure-samsar-custom-image-model.sh
```

If more than one administrator/user exists, select one explicitly without
putting any credential on the command line:

```bash
./configure-samsar-custom-image-model.sh --user-email admin@example.com
```

Or select another compatible model/configuration:

```bash
./provision-vast-flux2.sh \
  --model black-forest-labs/FLUX.2-klein-4B \
  --gpu 'RTX 5090' \
  --max-hourly-price 2.50
```

The default public endpoint is an HTTPS Cloudflare quick tunnel. Its hostname is
ephemeral and can change after an instance restart. `--public-mode mapped` uses
Vast's direct public port instead, but sends the API header over plain HTTP and is
not recommended for credentials or a live demo.

The final credential and adapter files are stored with mode `600` under
`~/.config/samsar/vast-flux2/`. The secret is not printed unless
`--show-secret` is explicitly supplied. Load the latest values with:

```bash
source ~/.config/samsar/vast-flux2/latest.env
```

The returned API contract is:

- `POST $SAMSAR_FLUX2_GENERATE_URL`
- `GET $SAMSAR_FLUX2_STATUS_URL` with `{request_id}` substituted
- `GET $SAMSAR_FLUX2_RESULT_URL` with `{request_id}` substituted
- `$SAMSAR_FLUX2_HEADER_KEY: $SAMSAR_FLUX2_HEADER_VALUE` on all three requests

The generated `latest.adapter.json` contains exactly the values to enter in the
Samsar Custom Adapters settings form, including the credential, so treat it as a
secret.

## Reconfigure or remove

Reinstall/update the service on an existing instance:

```bash
./provision-vast-flux2.sh --instance-id "$VAST_INSTANCE_ID"
```

Vast billing continues while the instance exists. Explicitly destroy it after
the demo:

```bash
./provision-vast-flux2.sh --destroy "$VAST_INSTANCE_ID"
```

Destroying an instance is permanent and makes its API URL unavailable.
