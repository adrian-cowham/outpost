# Use it from your phone or another machine

By default Outpost only listens on `localhost`. To reach it from your phone or another computer, put both on the same [Tailscale](https://tailscale.com) tailnet and the daemon serves HTTPS on its tailnet hostname. Nothing is exposed to the public internet.

**1. Install Tailscale on both devices.** On the Mac running Outpost:

```bash
brew install --cask tailscale-app   # or download from https://tailscale.com/download/mac
```

Open the menu-bar app and sign in, then confirm `tailscale status` shows a `100.x.y.z` IP. Install Tailscale on your phone or other machine and sign in with the **same account**.

**2. Enable HTTPS + MagicDNS** for your tailnet in the Tailscale admin console. This is a one-time account setting that gives the Mac a stable `<host>.ts.net` name and lets you mint a TLS cert for it. Follow Tailscale's [HTTPS / MagicDNS guide](https://tailscale.com/kb/1153/enabling-https).

**3. Create a TLS cert** for that hostname (on the Mac):

```bash
HOST=$(tailscale status --json | jq -r '.Self.DNSName' | sed 's/\.$//')
mkdir -p ~/.outpost
tailscale cert --cert-file ~/.outpost/$HOST.crt --key-file ~/.outpost/$HOST.key $HOST
```

You can also skip this step: if the cert is missing, the daemon logs the exact command to run.

**4. Restart Outpost** so it picks up the cert:

```bash
launchctl kickstart -k gui/$UID/local.outpost.$USER
```

**5. Open** `https://<your-host>.ts.net:8443/` on the other device. On a phone, add it to your home screen to install it as an app and get push notifications.

If the page doesn't load, check that Tailscale is signed in and switched on, on that device.

Under WSL2, run Tailscale inside the distro, not just on Windows — see [Linux / WSL2](linux-wsl.md).
