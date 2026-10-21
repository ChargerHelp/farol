import gql from 'graphql-tag'

export const userTypeDefs = gql`
  extend type Query {
    me: User
  }

  type User {
    id: ID!
    email: String!
  }
`
