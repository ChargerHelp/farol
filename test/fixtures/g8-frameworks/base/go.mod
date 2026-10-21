module example.com/shop

go 1.22

require (
	github.com/gin-gonic/gin v1.0.0
	github.com/labstack/echo/v4 v4.0.0
	google.golang.org/grpc v1.0.0
)

replace (
	github.com/gin-gonic/gin => ./third_party/gin
	github.com/labstack/echo/v4 => ./third_party/echo
	google.golang.org/grpc => ./third_party/grpc
)
