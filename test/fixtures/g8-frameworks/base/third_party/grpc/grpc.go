// Package grpc is a test stub with the API shape of google.golang.org/grpc that farol reads.
package grpc

type ServiceDesc struct{ ServiceName string }

type ServiceRegistrar interface{ RegisterService(desc *ServiceDesc, impl any) }

type Server struct{}

func NewServer() *Server                                       { return &Server{} }
func (s *Server) RegisterService(desc *ServiceDesc, impl any) {}
