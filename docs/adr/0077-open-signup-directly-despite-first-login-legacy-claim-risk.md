# Open signup directly despite first-login legacy claim risk

Public signup will open directly even though the legacy default tenant is claimed by the first successful Operator login. This intentionally accepts the risk that an external user could register before the intended owner and claim the legacy default tenant/account if the owner does not log in first.
