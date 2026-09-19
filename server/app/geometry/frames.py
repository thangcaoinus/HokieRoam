import numpy as np
from pyproj import Transformer

from app.schemas import Polygon2D, ProjectRequest


def project_polygon(request: ProjectRequest) -> Polygon2D:
    """Source CRS (x,y / longitude,latitude) -> local East/North meters."""
    geographic = Transformer.from_crs(request.source_crs, "EPSG:4326", always_xy=True)
    ecef = Transformer.from_crs("EPSG:4979", "EPSG:4978", always_xy=True)
    frame = request.frame
    lat, lon = np.radians([frame.origin_latitude, frame.origin_longitude])
    basis = np.array([
        [-np.sin(lon), np.cos(lon), 0],
        [-np.sin(lat)*np.cos(lon), -np.sin(lat)*np.sin(lon), np.cos(lat)],
    ])
    origin = np.array(ecef.transform(
        frame.origin_longitude, frame.origin_latitude, frame.origin_height_m, errcheck=True
    ))

    def ring(points):
        result = []
        for x, y in points:
            longitude, latitude = geographic.transform(x, y, errcheck=True)
            xyz = np.array(ecef.transform(
                longitude, latitude, frame.origin_height_m, errcheck=True
            ))
            result.append(tuple((basis @ (xyz - origin)).tolist()))
        return result

    return Polygon2D(exterior=ring(request.polygon.exterior),
                     holes=[ring(h) for h in request.polygon.holes])


def yaw(angle: float) -> np.ndarray:
    c, s = np.cos(angle), np.sin(angle)
    return np.array([[c, 0, s, 0], [0, 1, 0, 0], [-s, 0, c, 0], [0, 0, 0, 1.]])


def translation(x: float, y: float, z: float) -> np.ndarray:
    matrix = np.eye(4)
    matrix[:3, 3] = [x, y, z]
    return matrix


def normalization(up_axis: str, unit_scale: float) -> np.ndarray:
    matrix = np.eye(4)
    if up_axis == "Z":
        matrix[:3, :3] = [[1, 0, 0], [0, 0, 1], [0, -1, 0]]
    matrix[:3, :3] *= unit_scale
    return matrix
