# Use the official Golang image as a build stage
FROM golang:1.24-bookworm AS builder

# Set the working directory inside the container
WORKDIR /app

# Copy the Go module files and download dependencies
COPY go.mod ./
RUN go mod download

# Copy the rest of the application source code
COPY . .

# Build the Go application
RUN go build -o server

# Use a minimal base image to run the application
FROM debian:bookworm-slim

# Set the working directory inside the container
WORKDIR /app

# Copy the built application from the builder stage
COPY --from=builder /app/server .

# Expose the port the application runs on
EXPOSE 8080

# Command to run the application
CMD ["./server"]
