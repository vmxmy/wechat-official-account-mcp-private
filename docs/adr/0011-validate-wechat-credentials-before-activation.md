# Validate WeChat credentials before activation

We will validate submitted WeChat AppID/AppSecret credentials by obtaining a WeChat access token before marking a WeChat Official Account resource active. This prevents an apparently configured account from failing later during normal operations and surfaces IP whitelist, proxy, or credential errors at the moment of configuration.
