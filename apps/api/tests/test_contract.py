def test_openapi_contract_is_live(api):
    assert api.get("/health").json() == {"status": "ok"}
    spec = api.get("/openapi.json").json()
    assert spec["paths"]["/api/v1/me"]["get"]["security"] == [{"BearerAuth": []}]
    assert spec["paths"]["/api/v1/dev/seed"]["post"]["security"] == [{"DemoAdmin": []}]
    assert spec["paths"]["/api/v1/attempts/{id}/answers"]["post"]["responses"]["422"]["content"][
        "application/json"
    ]["schema"]["$ref"].endswith("/ErrorResponse")
    assert all("mock" not in str(operation.get("tags", []))
               for path in spec["paths"].values() for operation in path.values())
