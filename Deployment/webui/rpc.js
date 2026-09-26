(function () {
  var Twui = window.Twui = window.Twui || {};
  var nextId = 1;
  var sessionId = null;
  var authorization = null;

  function RpcError(message, info) {
    this.name = "RpcError";
    this.message = message;
    this.info = info || {};
  }
  RpcError.prototype = Object.create(Error.prototype);

  Twui.RpcError = RpcError;
  Twui.setAuthorization = function (value) { authorization = value; };
  Twui.clearAuthorization = function () { authorization = null; };
  Twui.clearSession = function () { sessionId = null; };

  Twui.rpc = function (method, params, options) {
    var id = nextId++;
    var body = JSON.stringify({
      jsonrpc: "2.0",
      method: method,
      params: params || {},
      id: id
    });
    var credentials = (options && options.credentials) || "same-origin";
    var retried = false;

    function once() {
      var headers = { "Content-Type": "application/json" };
      if (sessionId) headers["X-Transmission-Session-Id"] = sessionId;
      if (authorization && credentials !== "omit") headers.Authorization = authorization;
      var controller = new AbortController();
      var timer = setTimeout(function () { controller.abort(); }, 15000);
      return fetch(location.origin + "/transmission/rpc", {
        method: "POST",
        headers: headers,
        body: body,
        credentials: credentials,
        cache: "no-store",
        signal: controller.signal
      }).then(function (response) {
        clearTimeout(timer);
        if (response.status === 409) {
          var sid = response.headers.get("X-Transmission-Session-Id");
          var rpcVersion = response.headers.get("X-Transmission-Rpc-Version");
          if (rpcVersion) Twui.rpcVersionHeader = rpcVersion;
          if (!sid || retried) throw new RpcError("Transmission did not accept the session.", { conflict: true });
          sessionId = sid;
          retried = true;
          return once();
        }
        if (response.status === 401) throw new RpcError("Transmission did not accept the password.", { locked: true });
        if (response.status === 204) throw new RpcError("Empty response.", { network: true });
        if (response.status >= 500) throw new RpcError("Transmission did not respond.", { network: true });
        return response.json().then(function (data) {
          if (!data || typeof data !== "object") throw new RpcError("Transmission did not respond.", { network: true });
          if (data.result === "success" && data.arguments) throw new RpcError("This interface needs Transmission 4.1 or newer.", { legacy: true });
          if (data.id !== id) throw new RpcError("Transmission did not respond.", { network: true });
          if (data.error) {
            var extra = data.error.data && data.error.data.error_string;
            var message = data.error.message || "Transmission rejected the request.";
            if (extra) message = message + " " + extra;
            var error = new RpcError(message, { rpc: true, code: data.error.code });
            throw error;
          }
          if (!data.result || typeof data.result !== "object") throw new RpcError("Transmission did not respond.", { network: true });
          return data.result;
        });
      }, function () {
        clearTimeout(timer);
        throw new RpcError("Transmission did not respond.", { network: true });
      });
    }

    return once();
  };
})();
