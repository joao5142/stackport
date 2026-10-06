"""API Gateway service-specific routes.

Covers both flavours the console treats as separate products: the REST API
(apigateway, v1) with its resource tree and per-method integrations, and the
HTTP API (apigatewayv2) with its flat route list.
"""

from typing import Any

from fastapi import APIRouter, Depends, HTTPException

from backend.aws_client import get_client
from backend.routes.common import EndpointInfo, get_endpoint_info

router = APIRouter()

# get_resources caps at 500 per page and most stacks fit in one.
_PAGE_LIMIT = 500


def _rest(ep: EndpointInfo):
    return get_client("apigateway", **ep.client_kwargs())


def _http(ep: EndpointInfo):
    return get_client("apigatewayv2", **ep.client_kwargs())


# ---------------------------------------------------------------------------
# REST API (v1)


@router.get("/rest-apis")
def list_rest_apis(ep: EndpointInfo = Depends(get_endpoint_info)) -> dict[str, Any]:
    """List REST APIs."""
    try:
        return {"items": _rest(ep).get_rest_apis(limit=_PAGE_LIMIT).get("items", [])}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.get("/rest-apis/{api_id}/tree")
def get_rest_tree(api_id: str, ep: EndpointInfo = Depends(get_endpoint_info)) -> dict[str, Any]:
    """Resource tree of a REST API, each node carrying its declared methods.

    The console shows the tree before any method is selected, so the methods
    come along with the node and only the integration detail is lazy.
    """
    try:
        items = _rest(ep).get_resources(restApiId=api_id, limit=_PAGE_LIMIT).get("items", [])
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e

    by_id: dict[str, dict[str, Any]] = {}
    for it in items:
        by_id[it["id"]] = {
            "id": it["id"],
            "parentId": it.get("parentId"),
            "path": it.get("path", "/"),
            "pathPart": it.get("pathPart", "/"),
            "methods": sorted((it.get("resourceMethods") or {}).keys()),
            "children": [],
        }

    roots: list[dict[str, Any]] = []
    for node in by_id.values():
        parent = by_id.get(node["parentId"]) if node["parentId"] else None
        if parent is None:
            roots.append(node)
        else:
            parent["children"].append(node)

    def sort_tree(nodes: list[dict[str, Any]]) -> None:
        nodes.sort(key=lambda n: n["path"])
        for n in nodes:
            sort_tree(n["children"])

    sort_tree(roots)
    total_methods = sum(len(n["methods"]) for n in by_id.values())
    return {"tree": roots, "resourceCount": len(by_id), "methodCount": total_methods}


@router.get("/rest-apis/{api_id}/resources/{resource_id}/methods/{http_method}")
def get_rest_method(
    api_id: str,
    resource_id: str,
    http_method: str,
    ep: EndpointInfo = Depends(get_endpoint_info),
) -> dict[str, Any]:
    """Method plus its integration, which is what the console detail pane shows."""
    client = _rest(ep)
    verb = http_method.upper()
    try:
        method = client.get_method(restApiId=api_id, resourceId=resource_id, httpMethod=verb)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e

    method.pop("ResponseMetadata", None)
    integration = method.get("methodIntegration")
    if integration is None:
        # Older emulators omit methodIntegration from get_method.
        try:
            integration = client.get_integration(
                restApiId=api_id, resourceId=resource_id, httpMethod=verb
            )
            integration.pop("ResponseMetadata", None)
        except Exception:
            integration = None

    return {"method": method, "integration": integration}


@router.get("/rest-apis/{api_id}/stages")
def get_rest_stages(api_id: str, ep: EndpointInfo = Depends(get_endpoint_info)) -> dict[str, Any]:
    """Stages of a REST API, with the stage variables the integrations read."""
    try:
        return {"item": _rest(ep).get_stages(restApiId=api_id).get("item", [])}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e


# ---------------------------------------------------------------------------
# HTTP API (v2)


@router.get("/apis")
def list_http_apis(ep: EndpointInfo = Depends(get_endpoint_info)) -> dict[str, Any]:
    """List HTTP APIs."""
    try:
        return {"items": _http(ep).get_apis(MaxResults=str(_PAGE_LIMIT)).get("Items", [])}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.get("/apis/{api_id}/routes")
def get_http_routes(api_id: str, ep: EndpointInfo = Depends(get_endpoint_info)) -> dict[str, Any]:
    """Routes of an HTTP API as a tree, the way the console nests them.

    A RouteKey is "<VERB> <path>"; the path is split on "/" so that sibling
    routes share their prefix instead of repeating it on every row.
    """
    client = _http(ep)
    try:
        routes = client.get_routes(ApiId=api_id, MaxResults=str(_PAGE_LIMIT)).get("Items", [])
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e

    raiz: dict[str, Any] = {"segment": "/", "path": "", "methods": [], "filhos": {}}

    for r in routes:
        key = r.get("RouteKey", "")
        verb, _, path = key.partition(" ")
        if not path:
            verb, path = "ANY", key

        no = raiz
        for parte in [p for p in path.split("/") if p]:
            filho = no["filhos"].get(parte)
            if filho is None:
                filho = {
                    "segment": f"/{parte}",
                    "path": f"{no['path']}/{parte}",
                    "methods": [],
                    "filhos": {},
                }
                no["filhos"][parte] = filho
            no = filho

        no["methods"].append(
            {
                "routeId": r.get("RouteId"),
                "method": verb,
                "routeKey": key,
                "authorizationType": r.get("AuthorizationType", "NONE"),
                "authorizerId": r.get("AuthorizerId"),
                "target": r.get("Target"),
            }
        )

    def ordenar(no: dict[str, Any]) -> dict[str, Any]:
        return {
            "segment": no["segment"],
            "path": no["path"] or "/",
            "methods": sorted(no["methods"], key=lambda m: m["method"]),
            "children": [ordenar(f) for _, f in sorted(no["filhos"].items())],
        }

    return {"tree": [ordenar(f) for _, f in sorted(raiz["filhos"].items())], "routeCount": len(routes)}


@router.get("/apis/{api_id}/routes/{route_id}")
def get_http_route(
    api_id: str, route_id: str, ep: EndpointInfo = Depends(get_endpoint_info)
) -> dict[str, Any]:
    """Route detail, resolving the integration and authorizer it points at."""
    client = _http(ep)
    try:
        route = client.get_route(ApiId=api_id, RouteId=route_id)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e
    route.pop("ResponseMetadata", None)

    integration = None
    target = route.get("Target") or ""
    if target.startswith("integrations/"):
        try:
            integration = client.get_integration(
                ApiId=api_id, IntegrationId=target.split("/", 1)[1]
            )
            integration.pop("ResponseMetadata", None)
        except Exception:
            integration = None

    authorizer = None
    if route.get("AuthorizerId"):
        try:
            authorizer = client.get_authorizer(
                ApiId=api_id, AuthorizerId=route["AuthorizerId"]
            )
            authorizer.pop("ResponseMetadata", None)
        except Exception:
            authorizer = None

    return {"route": route, "integration": integration, "authorizer": authorizer}


@router.get("/apis/{api_id}/stages")
def get_http_stages(api_id: str, ep: EndpointInfo = Depends(get_endpoint_info)) -> dict[str, Any]:
    """Stages of an HTTP API."""
    try:
        return {"items": _http(ep).get_stages(ApiId=api_id).get("Items", [])}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e
