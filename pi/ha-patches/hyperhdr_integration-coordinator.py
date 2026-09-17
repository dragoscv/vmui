"""DataUpdateCoordinator for HyperHDR."""

from __future__ import annotations

import logging
from datetime import timedelta
from typing import Any

import aiohttp
import async_timeout

from homeassistant.core import HomeAssistant
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator, UpdateFailed

from .const import DEFAULT_PRIORITY, DOMAIN, UPDATE_INTERVAL

_LOGGER = logging.getLogger(__name__)


class HyperHDRCoordinator(DataUpdateCoordinator[dict[str, Any]]):
    """Manage HyperHDR API communication and shared runtime state."""

    def __init__(self, hass: HomeAssistant, host: str, port: int, token: str | None) -> None:
        """Initialize the coordinator."""
        self.host = host
        self.port = port
        self.token = token or ""
        self.url = f"http://{host}:{port}/json-rpc"
        self.session = async_get_clientsession(hass)

        # Shared value used by both the number entity and the light entity.
        # The number entity restores and updates this value.
        self.priority = DEFAULT_PRIORITY
        self.light_entity = None
        self.last_command_payload: dict[str, Any] | None = None
        self.last_command_response: dict[str, Any] | None = None

        super().__init__(
            hass,
            _LOGGER,
            name=DOMAIN,
            update_interval=timedelta(seconds=UPDATE_INTERVAL),
        )

    @property
    def headers(self) -> dict[str, str]:
        """Return API request headers."""
        return {"Authorization": f"token {self.token}"} if self.token else {}

    async def _async_update_data(self) -> dict[str, Any]:
        """Fetch HyperHDR server info."""
        response = await self._async_post({"command": "serverinfo"}, raise_on_error=True)
        return response.get("info", {})

    async def _async_post(
        self,
        payload: dict[str, Any],
        *,
        raise_on_error: bool = False,
    ) -> dict[str, Any]:
        """Send a raw JSON-RPC command to HyperHDR."""
        try:
            async with async_timeout.timeout(10):
                async with self.session.post(
                    self.url,
                    json=payload,
                    headers=self.headers,
                ) as response:
                    if response.status in (401, 403):
                        message = "Invalid HyperHDR token"
                        if raise_on_error:
                            raise UpdateFailed(message)
                        _LOGGER.warning(message)
                        return {}

                    if response.status != 200:
                        message = f"HyperHDR API returned HTTP {response.status}"
                        if raise_on_error:
                            raise UpdateFailed(message)
                        _LOGGER.warning(message)
                        return {}

                    data = await response.json()
                    if data.get("success") is False:
                        message = f"HyperHDR API error: {data.get('error', 'Unknown error')}"
                        if raise_on_error:
                            raise UpdateFailed(message)
                        _LOGGER.warning(message)

                    return data

        except aiohttp.ClientError as err:
            if raise_on_error:
                raise UpdateFailed(f"Error communicating with HyperHDR: {err}") from err
            _LOGGER.error("Error communicating with HyperHDR: %s", err)
        except Exception as err:  # noqa: BLE001 - keep HA integration resilient
            if raise_on_error:
                raise UpdateFailed(f"Unexpected HyperHDR error: {err}") from err
            _LOGGER.error("Unexpected HyperHDR error: %s", err)

        return {}

    async def async_send_command(
        self,
        payload: dict[str, Any],
        *,
        refresh: bool = True,
    ) -> dict[str, Any] | None:
        """Send one command to HyperHDR and optionally refresh coordinator data."""
        self.last_command_payload = payload
        _LOGGER.debug("Sending HyperHDR command: %s", payload)
        result = await self._async_post(payload)
        self.last_command_response = result or None
        _LOGGER.debug("HyperHDR command response: %s", result)
        if refresh:
            await self.async_request_refresh()
        return result or None

    async def async_send_commands(
        self,
        payloads: list[dict[str, Any]],
        *,
        refresh: bool = True,
    ) -> None:
        """Send multiple commands and refresh only once at the end.

        Refreshing after every command can briefly expose intermediate states in Home Assistant
        and may make visual transitions look worse. This helper keeps command bursts tighter.
        """
        for payload in payloads:
            await self.async_send_command(payload, refresh=False)

        if refresh:
            await self.async_request_refresh()

    def visible_priority(self) -> dict[str, Any] | None:
        """Return the currently visible HyperHDR priority, if any."""
        if not self.data:
            return None
        priorities = self.data.get("priorities", [])
        return next((item for item in priorities if item.get("visible", False)), None)


    def priority_item(self, priority: int) -> dict[str, Any] | None:
        """Return the HyperHDR priority item matching a priority number, if present."""
        if not self.data:
            return None
        priorities = self.data.get("priorities", [])
        return next((item for item in priorities if item.get("priority") == priority), None)

    def is_priority_active(self, priority: int) -> bool:
        """Return True if the requested priority exists and is active."""
        item = self.priority_item(priority)
        return bool(item and item.get("active", False))

    def is_priority_visible(self, priority: int) -> bool:
        """Return True if the requested priority is currently visible."""
        visible = self.visible_priority()
        return bool(visible and visible.get("priority") == priority)
