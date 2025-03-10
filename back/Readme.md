docker build -t go-server .


docker run --network host -e DB_USER=postgres -e DB_NAME=hello_db -e DB_HOST=127.0.0.1 go-server


psql -h 127.0.0.1 -p 5432 -U postgres -d postgres

DB_USER=postgres DB_NAME=hello_db DB_HOST=127.0.0.1 go run .