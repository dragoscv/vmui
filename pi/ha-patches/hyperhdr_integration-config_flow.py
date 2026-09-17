"""Config flow for HyperHDR Integration."""

from __future__ import annotations

from typing import Any

import async_timeout
import voluptuous as vol

from homeassistant import config_entries
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.aiohttp_client import async_get_clientsession

from .const import (
    CONF_HOST,
    CONF_NAME,
    CONF_PORT,
    CONF_TOKEN,
    DEFAULT_NAME,
    DEFAULT_PORT,
    DOMAIN,
)


def get_schema(defaults: dict[str, Any] | None = None) -> vol.Schema:
    """Generate the config/options form schema."""
    defaults = defaults or {}
    return vol.Schema(
        {
            vol.Required(CONF_HOST, default=defaults.get(CONF_HOST, "")): str,
            vol.Required(CONF_PORT, default=defaults.get(CONF_PORT, DEFAULT_PORT)): int,
            vol.Optional(CONF_NAME, default=defaults.get(CONF_NAME, DEFAULT_NAME)): str,
            vol.Optional(CONF_TOKEN, default=defaults.get(CONF_TOKEN, "")): str,
        }
    )


async def validate_input(hass: HomeAssistant, data: dict[str, Any]) -> None:
    """Validate HyperHDR connection settings."""
    host = data[CONF_HOST]
    port = data[CONF_PORT]
    token = data.get(CONF_TOKEN, "")
    url = f"http://{host}:{port}/json-rpc"
    headers = {"Authorization": f"token {token}"} if token else {}

    session = async_get_clientsession(hass)

    try:
        async with async_timeout.timeout(5):
            async with session.post(
                url,
                json={"command": "serverinfo"},
                headers=headers,
            ) as response:
                if response.status in (401, 403):
                    raise ValueError("invalid_auth")

                if response.status != 200:
                    raise ValueError("cannot_connect")

                payload = await response.json()
                if payload.get("success") is False:
                    raise ValueError("invalid_auth")

    except ValueError:
        raise
    except Exception as err:  # noqa: BLE001 - config flow should return friendly HA errors
        raise ValueError("cannot_connect") from err


class HyperHDRConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    """Handle the initial HyperHDR setup flow."""

    VERSION = 1

    @staticmethod
    @callback
    def async_get_options_flow(config_entry: config_entries.ConfigEntry) -> HyperHDROptionsFlow:
        """Return the options flow handler."""
        return HyperHDROptionsFlow(config_entry)

    async def async_step_user(self, user_input: dict[str, Any] | None = None):
        """Handle the user setup step."""
        errors: dict[str, str] = {}

        if user_input is not None:
            try:
                await validate_input(self.hass, user_input)
                await self.async_set_unique_id(f"{user_input[CONF_HOST]}:{user_input[CONF_PORT]}")
                self._abort_if_unique_id_configured()
                return self.async_create_entry(
                    title=user_input.get(CONF_NAME, DEFAULT_NAME),
                    data=user_input,
                )
            except ValueError as err:
                errors["base"] = str(err)
            except Exception:  # noqa: BLE001
                errors["base"] = "unknown"

        return self.async_show_form(
            step_id="user",
            data_schema=get_schema(),
            errors=errors,
        )


class HyperHDROptionsFlow(config_entries.OptionsFlow):
    """Handle HyperHDR options updates."""

    def __init__(self, config_entry: config_entries.ConfigEntry) -> None:
        """Initialize options flow."""
        self._config_entry = config_entry

    async def async_step_init(self, user_input: dict[str, Any] | None = None):
        """Handle the options step."""
        errors: dict[str, str] = {}

        if user_input is not None:
            try:
                await validate_input(self.hass, user_input)
                self.hass.config_entries.async_update_entry(
                    self._config_entry,
                    title=user_input.get(CONF_NAME, DEFAULT_NAME),
                    data=user_input,
                )
                return self.async_create_entry(title="", data={})
            except ValueError as err:
                errors["base"] = str(err)
            except Exception:  # noqa: BLE001
                errors["base"] = "unknown"

        return self.async_show_form(
            step_id="init",
            data_schema=get_schema(self._config_entry.data),
            errors=errors,
        )
