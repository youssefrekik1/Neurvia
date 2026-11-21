from pydantic import SecretStr

from tools.export_contract import DEMO_KEY, exercise_contract


def test_every_operation_has_an_exercised_example(api):
    api.app.state.settings.demo_admin_secret = SecretStr(DEMO_KEY)
    spec = exercise_contract(api)
    assert "/api/v1/lessons/{id}/before-after" in spec["paths"]
    assert spec["paths"]["/api/v1/auth/login"]["post"]["responses"]["200"]["content"][
        "application/json"
    ]["example"]["access_token"] == "eyJ...example"
